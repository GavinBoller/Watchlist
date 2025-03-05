import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";

export interface SessionCheckResult {
  authenticated: boolean;
  user: any | null;
  emergencyMode?: boolean;
  error?: string;
  sessionId?: string;
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
      
      // Extract and log headers safely
      const headers: Record<string, string> = {};
      sessionResponse.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.log('Session check response headers:', JSON.stringify(headers));
      
      // Handle non-ok responses
      if (!sessionResponse.ok) {
        console.error(`Primary session check failed with status: ${sessionResponse.status}`);
      } else {
        // Parse response if possible
        try {
          sessionCheckResult = await sessionResponse.json();
          console.log('Primary session check successful:', sessionCheckResult);
          
          // Store the session ID for emergency recovery
          if (sessionCheckResult?.sessionId) {
            try {
              localStorage.setItem('movietracker_session_id', sessionCheckResult.sessionId);
            } catch (e) {
              console.error('Failed to store session ID in localStorage:', e);
            }
          }
          
          // If authenticated, store the user data
          if (sessionCheckResult?.authenticated && sessionCheckResult?.user) {
            try {
              localStorage.setItem('movietracker_user', JSON.stringify(sessionCheckResult.user));
              localStorage.setItem('movietracker_last_verified', new Date().toISOString());
            } catch (e) {
              console.error('Failed to store user data in localStorage:', e);
            }
          }
          
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
          
          // Also store the user data for potential future emergency recovery
          try {
            localStorage.setItem('movietracker_user', JSON.stringify(userData));
            localStorage.setItem('movietracker_last_verified', new Date().toISOString());
          } catch (e) {
            console.error('Failed to store user data in localStorage:', e);
          }
          
          return sessionCheckResult;
        } catch (parseError) {
          console.error('Error parsing user response:', parseError);
        }
      }
    } catch (userError) {
      console.error('Network error checking user endpoint:', userError);
    }
    
    // 3. Check if we have temporary registration data from a recent registration
    if (window.__tempRegistrationData && 
        window.__tempRegistrationData.timestamp > (Date.now() - 30000)) { // 30 second window
      console.log('Found recent registration data, attempting to use it for recovery');
      
      try {
        // Try to recover session using the temporary registration data
        const username = window.__tempRegistrationData.username;
        
        // Try to find the user in localStorage (might have been stored during registration)
        const cachedUser = localStorage.getItem('movietracker_user');
        if (cachedUser) {
          try {
            const userData = JSON.parse(cachedUser);
            if (userData.username === username) {
              console.log('Found matching user in localStorage for temp registration data');
              
              // Use the stored user data
              sessionCheckResult = {
                authenticated: true,
                user: userData,
                emergencyMode: true
              };
              
              // Attempt to recover the session via the refresh endpoint
              try {
                console.log('Attempting session recovery with userId:', userData.id);
                const recoveryResponse = await fetch(`/api/refresh-session?userId=${userData.id}`, {
                  method: 'GET',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                  }
                });
                
                if (recoveryResponse.ok) {
                  const recoveryData = await recoveryResponse.json();
                  console.log('Session recovery successful:', recoveryData);
                  
                  // If recovery was successful, use this data instead
                  if (recoveryData.authenticated && recoveryData.user) {
                    sessionCheckResult = {
                      authenticated: true,
                      user: recoveryData.user,
                      emergencyMode: false,
                      sessionId: recoveryData.sessionId
                    };
                    
                    // Clear the temporary registration data since we've recovered
                    window.__tempRegistrationData = undefined;
                    
                    console.log('Successfully recovered session from temp registration data');
                  }
                } else {
                  console.warn('Session recovery attempt failed, status:', recoveryResponse.status);
                }
              } catch (recoveryError) {
                console.error('Error during session recovery attempt:', recoveryError);
              }
              
              return sessionCheckResult;
            }
          } catch (parseError) {
            console.error('Error parsing cached user data from localStorage:', parseError);
          }
        }
      } catch (tempDataError) {
        console.error('Error processing temporary registration data:', tempDataError);
      }
    }
    
    // 4. Try to read from localStorage as a last resort
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        console.log('No session from remote endpoints, checking local storage...');
        const cachedUser = localStorage.getItem('movietracker_user');
        const cachedSessionId = localStorage.getItem('movietracker_session_id');
        const lastVerified = localStorage.getItem('movietracker_last_verified');
        
        // Check if we have data and it's not too old (24 hours max)
        const isDataRecent = lastVerified && 
          (new Date().getTime() - new Date(lastVerified).getTime() < 24 * 60 * 60 * 1000);
        
        if (cachedUser && (cachedSessionId || isDataRecent)) {
          console.log('Found cached user data in localStorage', isDataRecent ? '(recent)' : '(with session ID)');
          try {
            const userData = JSON.parse(cachedUser);
            
            // Create a session result from localStorage
            sessionCheckResult = {
              authenticated: true,
              user: userData,
              emergencyMode: true, // Flag this as emergency mode
              sessionId: cachedSessionId || undefined
            };
            
            // Note the emergency recovery in localStorage
            localStorage.setItem('movietracker_session_recovery', 'local_storage');
            localStorage.setItem('movietracker_emergency_ts', new Date().toISOString());
            
            // Try to recover the session via the refresh endpoint with the user ID
            if (userData.id) {
              try {
                console.log('Attempting emergency session recovery with userId:', userData.id);
                const recoveryResponse = await fetch(`/api/refresh-session?userId=${userData.id}`, {
                  method: 'GET',
                  credentials: 'include',
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                  }
                });
                
                if (recoveryResponse.ok) {
                  const recoveryData = await recoveryResponse.json();
                  console.log('Emergency session recovery response:', recoveryData);
                  
                  // If recovery worked, update our result
                  if (recoveryData.authenticated && recoveryData.user) {
                    sessionCheckResult.emergencyMode = false;
                    sessionCheckResult.sessionId = recoveryData.sessionId;
                    console.log('Successfully recovered session on server');
                  }
                } else {
                  console.warn('Emergency recovery failed, status:', recoveryResponse.status);
                }
              } catch (recoveryError) {
                console.error('Error during emergency recovery attempt:', recoveryError);
              }
            } else {
              // Try a basic session refresh as fallback
              fetch('/api/refresh-session', {
                credentials: 'include'
              }).then(res => {
                console.log('Basic session refresh status:', res.status);
              }).catch(e => {
                console.error('Basic session refresh failed:', e);
              });
            }
            
            console.log('Using emergency session from localStorage:', sessionCheckResult);
            return sessionCheckResult;
          } catch (parseError) {
            console.error('Error parsing cached user data:', parseError);
          }
        } else {
          console.log('No usable cached user data found in localStorage');
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
  
  // First check: Try to recover the session using our robust recovery system
  try {
    // Attempt session recovery with userId if we have cached user data
    const cachedUser = localStorage.getItem('movietracker_user');
    if (cachedUser) {
      try {
        const userData = JSON.parse(cachedUser);
        if (userData?.id) {
          console.log('Attempting session recovery with stored user ID:', userData.id);
          
          // Try to recover the session using the user ID
          const recoveryResponse = await fetch(`/api/refresh-session?userId=${userData.id}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            }
          });
          
          if (recoveryResponse.ok) {
            const recoveryData = await recoveryResponse.json();
            console.log('Session recovery attempt result:', recoveryData);
            
            if (recoveryData.authenticated && recoveryData.user) {
              console.log('Session successfully recovered!');
              
              // Update the query cache with the recovered user
              queryClient.setQueryData(["/api/user"], recoveryData.user);
              
              // Record successful recovery
              localStorage.setItem('movietracker_recovery_successful', 'true');
              localStorage.setItem('movietracker_recovery_time', new Date().toISOString());
              
              // No need to continue with session expiration
              return;
            }
          }
        }
      } catch (recoveryError) {
        console.error('Error during recovery attempt:', recoveryError);
      }
    }
  } catch (e) {
    console.error('Error during initial recovery attempt:', e);
  }
  
  // Second check: try session endpoint
  const sessionData = await checkSessionStatus();
  
  // If session status shows authenticated, we don't need to do anything
  if (sessionData?.authenticated) {
    console.log('User appears to be authenticated despite error - IGNORING');
    
    // Update the queryClient with any recovered user data
    if (sessionData.user) {
      queryClient.setQueryData(["/api/user"], sessionData.user);
    }
    
    return;
  }
  
  // Third check: try direct API call to user endpoint for final confirmation
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
      
      try {
        const userData = await directUserResponse.json();
        if (userData) {
          // Update the query cache
          queryClient.setQueryData(["/api/user"], userData);
        }
      } catch (parseError) {
        console.error('Error parsing user data from final check:', parseError);
      }
      
      return;
    }
  } catch (e) {
    // Failed to check - continue with session expiration
    console.log('Final authentication check failed:', e);
  }
  
  // If we get here, we're reasonably confident the session is truly expired
  console.log('Session is confirmed expired, clearing client state');
  
  // Clear recovery flags
  try {
    localStorage.removeItem('movietracker_recovery_successful');
    localStorage.removeItem('movietracker_recovery_time');
  } catch (e) {
    console.error('Error clearing recovery flags:', e);
  }
  
  // Clear all user data from the client
  queryClient.setQueryData(["/api/user"], null);
  queryClient.setQueryData(["/api/auth/user"], null);
  queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
  
  // Only show the toast if we're going to redirect
  if (window.location.pathname !== '/auth') {
    console.log('User not on auth page, showing notification');
    
    // Determine if this is a network issue or auth issue
    const isNetworkProblem = errorCode === 'NETWORK_ERROR' || 
                            (errorMessage && errorMessage.toLowerCase().includes('network'));
    
    // Show an appropriate message
    toast({
      title: isNetworkProblem ? "Connection issue" : "Authentication needed",
      description: errorMessage || (isNetworkProblem ? 
                                  "Please check your internet connection" : 
                                  "Please sign in to continue"),
      variant: isNetworkProblem ? "destructive" : "default",
    });
    
    // For network issues, we might not want to redirect immediately
    const finalRedirectDelay = isNetworkProblem ? redirectDelay * 1.5 : redirectDelay;
    
    // Redirect to login page
    console.log(`Redirecting to auth page after ${isNetworkProblem ? 'network issue' : 'session expiration'}`);
    setTimeout(() => {
      window.location.href = '/auth';
    }, finalRedirectDelay);
  } else {
    console.log('User already on auth page, no redirect needed');
  }
}

/**
 * Check if the current error is an authentication/session error
 * Returns an object with detailed classification of the error
 */
type ErrorType = 'auth_error' | 'network_error' | 'other_error';

export function isSessionError(error: any): { 
  isAuthError: boolean;
  isNetworkError: boolean;
  errorType: ErrorType;
  errorMessage?: string;
} {
  // Default result
  const result = {
    isAuthError: false,
    isNetworkError: false,
    errorType: 'other_error' as ErrorType,
    errorMessage: undefined as string | undefined
  };
  
  // If no error, return immediately
  if (!error) return result;
  
  // Extract error message from various possible formats
  const errorMsg = (
    error.message || 
    error.data?.message || 
    error.error?.message || 
    error.statusText ||
    ''
  ).toLowerCase();
  
  // Set error message for return
  result.errorMessage = errorMsg || undefined;
  
  // Check for network errors
  const networkErrorPatterns = [
    'network',
    'failed to fetch',
    'connection',
    'offline',
    'timeout',
    'aborted',
    'internet',
    'socket',
    'unreachable',
    'refused'
  ];
  
  // Check for auth errors - explicit status code check
  if (error.status === 401 || error.statusCode === 401) {
    result.isAuthError = true;
    result.errorType = 'auth_error';
    return result;
  }
  
  // Check for network error patterns
  if (networkErrorPatterns.some(pattern => errorMsg.includes(pattern))) {
    result.isNetworkError = true;
    result.errorType = 'network_error';
    return result;
  }
  
  // Check for specific auth error patterns
  const sessionErrorPatterns = [
    'unauthorized',
    'unauthenticated', 
    'not authenticated',
    'session expired',
    'invalid session',
    'login required',
    'authentication required',
    'access denied',
    'permission denied',
    'forbidden'
  ];
  
  // Check auth error message patterns
  if (sessionErrorPatterns.some(pattern => errorMsg.includes(pattern))) {
    result.isAuthError = true;
    result.errorType = 'auth_error';
    return result;
  }
  
  return result;
}

/**
 * Legacy version for backward compatibility
 * @deprecated Use the detailed version instead
 */
export function isSessionErrorOld(error: any): boolean {
  return isSessionError(error).isAuthError;
}