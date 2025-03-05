import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";

export interface SessionCheckResult {
  authenticated: boolean;
  user: any | null;
  emergencyMode?: boolean;
  error?: string;
}

/**
 * Check the current session status
 * Returns session status information or null if an error occurs
 */
export async function checkSessionStatus(): Promise<SessionCheckResult | null> {
  const sessionUrl = "/api/session";
  console.log('Checking current session status via', sessionUrl);
  
  try {
    // Use fetch directly to avoid any potential API client issues
    const sessionResponse = await fetch(sessionUrl, {
      credentials: "include", // Important: Include credentials
      headers: {
        // Prevent caching
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache"
      }
    });
    
    // Handle non-ok responses
    if (!sessionResponse.ok) {
      console.error(`Session check failed with status: ${sessionResponse.status}`);
      return null;
    }
    
    // Parse response if possible
    try {
      const sessionData = await sessionResponse.json();
      console.log('Session check response:', sessionData);
      return sessionData;
    } catch (parseError) {
      console.error('Error parsing session response:', parseError);
      return null;
    }
  } catch (error) {
    console.error('Network error checking session status:', error);
    return null;
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