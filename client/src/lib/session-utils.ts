import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";

export interface SessionCheckResult {
  authenticated: boolean;
  user: any | null;
  emergencyMode?: boolean;
  error?: string;
}

/**
 * Check the current session status with enhanced reliability
 * Attempts multiple strategies to determine the correct session state
 * Returns session status information or null if all checks fail
 */
export async function checkSessionStatus(): Promise<SessionCheckResult | null> {
  // Record start time for performance logging
  const startTime = performance.now();
  const sessionUrl = "/api/session";
  let sessionCheckResult: SessionCheckResult | null = null;
  let fallbacksUsed = false;
  
  console.log('Session check starting:', new Date().toISOString());
  console.log('Primary endpoint:', sessionUrl);
  
  // Try all available session check methods in sequence
  try {
    // 1. Try the primary session endpoint first
    try {
      console.log('Attempting primary session check via', sessionUrl);
      
      // Use fetch directly to avoid any potential API client issues
      const sessionResponse = await fetch(sessionUrl, {
        credentials: "include", // Important: Include credentials
        headers: {
          // Prevent caching
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      
      // Log detailed response info for debugging
      console.log('Session check response status:', sessionResponse.status);
      console.log('Session check response headers:', JSON.stringify(Object.fromEntries([...sessionResponse.headers.entries()])));
      
      // Handle non-ok responses
      if (!sessionResponse.ok) {
        console.error(`Primary session check failed with status: ${sessionResponse.status}`);
      } else {
        // Parse response if possible
        try {
          sessionCheckResult = await sessionResponse.json();
          console.log('Primary session check successful:', sessionCheckResult);
          // Successfully got data from primary endpoint
          return sessionCheckResult;
        } catch (parseError) {
          console.error('Error parsing session response:', parseError);
        }
      }
    } catch (primaryError) {
      console.error('Network error on primary session check:', primaryError);
    }
    
    // If we get here, the primary check failed - start trying fallbacks
    fallbacksUsed = true;
    
    // 2. Try the /api/user endpoint as an alternative
    try {
      console.log('Primary session check failed, trying user endpoint...');
      const userResponse = await fetch('/api/user', {
        credentials: "include",
        headers: {
          "Accept": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      
      console.log('User endpoint response status:', userResponse.status);
      
      if (userResponse.ok) {
        try {
          const userData = await userResponse.json();
          console.log('Got user data from fallback endpoint:', userData);
          
          // Create a session result from the user data
          sessionCheckResult = {
            authenticated: true,
            user: userData,
            emergencyMode: false
          };
          
          // Store the recovery method for debugging
          localStorage.setItem('movietracker_session_recovery', 'user_endpoint');
          
          return sessionCheckResult;
        } catch (parseError) {
          console.error('Error parsing user response:', parseError);
        }
      }
    } catch (userError) {
      console.error('Network error checking user endpoint:', userError);
    }
    
    // 3. Try to read from localStorage as a last resort
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        console.log('No session from remote endpoints, checking local storage...');
        const cachedUser = localStorage.getItem('movietracker_user');
        const cachedSessionId = localStorage.getItem('movietracker_session_id');
        
        if (cachedUser && cachedSessionId) {
          console.log('Found cached user and session in localStorage');
          try {
            const userData = JSON.parse(cachedUser);
            
            // Create a session result from localStorage
            sessionCheckResult = {
              authenticated: true,
              user: userData,
              emergencyMode: true // Flag this as emergency mode
            };
            
            // Note the emergency recovery in localStorage
            localStorage.setItem('movietracker_session_recovery', 'local_storage');
            localStorage.setItem('movietracker_emergency_ts', new Date().toISOString());
            
            // Try to refresh the session in the background
            fetch('/api/refresh-session', {
              credentials: 'include'
            }).then(res => {
              console.log('Background session refresh status:', res.status);
            }).catch(e => {
              console.error('Background session refresh failed:', e);
            });
            
            console.log('Created emergency session from localStorage:', sessionCheckResult);
            return sessionCheckResult;
          } catch (parseError) {
            console.error('Error parsing cached user data:', parseError);
          }
        } else {
          console.log('No cached user data found in localStorage');
        }
      } catch (localStorageError) {
        console.error('Error accessing localStorage:', localStorageError);
      }
    }
    
    // If we got to here, all checks failed
    console.error('All session verification methods failed');
    return null;
  } finally {
    // Log performance metrics for monitoring
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.log(`Session check completed in ${duration.toFixed(2)}ms. Fallbacks used: ${fallbacksUsed}`);
  }
}

/**
 * Handle a session expiration event consistently across the application
 * Can be called from any component when a 401 error is received
 * 
 * @param errorCode Optional error code from the API
 * @param errorMessage Optional error message from the API
 * @param redirectDelay Delay in milliseconds before redirecting to auth page
 */
export async function handleSessionExpiration(
  errorCode?: string | number, 
  errorMessage?: string,
  redirectDelay: number = 1500
): Promise<void> {
  console.log('Handling session expiration check:', errorCode, errorMessage);
  
  // Enhanced session verification with multiple checks to avoid false logouts
  
  // First check: try session endpoint
  const sessionData = await checkSessionStatus();
  
  // If session status shows authenticated, we don't need to do anything
  if (sessionData?.authenticated) {
    console.log('User appears to be authenticated despite error - IGNORING');
    return;
  }
  
  // Second check: try direct API call to user endpoint for final confirmation
  console.log('Session appears expired, doing final verification...');
  try {
    const directUserResponse = await fetch('/api/user', {
      credentials: 'include',
      headers: {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    
    if (directUserResponse.ok) {
      // User is actually authenticated!
      console.log('User verified as authenticated in final check - IGNORING ERROR');
      return;
    }
  } catch (e) {
    // Failed to check - continue with session expiration
    console.log('Final authentication check failed:', e);
  }
  
  // If we get here, we're reasonably confident the session is truly expired
  console.log('Session is confirmed expired, clearing client state');
  
  // Clear all user data from the client
  queryClient.setQueryData(["/api/user"], null);
  queryClient.setQueryData(["/api/auth/user"], null);
  queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
  
  // Only show the toast if we're going to redirect
  if (window.location.pathname !== '/auth') {
    console.log('User not on auth page, showing notification');
    // Show a gentle message
    toast({
      title: "Authentication needed",
      description: errorMessage || "Please sign in to continue",
      variant: "default",
    });
    
    // Redirect to login page
    console.log('Redirecting to auth page after session expiration');
    setTimeout(() => {
      window.location.href = '/auth';
    }, redirectDelay);
  } else {
    console.log('User already on auth page, no redirect needed');
  }
}

/**
 * Check if the current error is an authentication/session error
 */
export function isSessionError(error: any): boolean {
  // Check for status code
  if (error?.status === 401) return true;
  
  // Check for error message patterns
  const errorMsg = error?.message || error?.data?.message || '';
  const sessionErrorPatterns = [
    'unauthorized',
    'unauthenticated', 
    'not authenticated',
    'session expired',
    'invalid session',
    'login required',
    'authentication required'
  ];
  
  return sessionErrorPatterns.some(pattern => 
    errorMsg.toLowerCase().includes(pattern.toLowerCase())
  );
}