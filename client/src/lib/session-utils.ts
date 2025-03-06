import { toast } from "@/hooks/use-toast";
import { queryClient } from "./queryClient";

export interface SessionCheckResult {
  authenticated: boolean;
  user: any | null;
  emergencyMode?: boolean;
  error?: string;
  sessionId?: string;
  autoLogoutDetected?: boolean;
  specialUserProtection?: boolean;
  sessionRecovered?: boolean;
  fallbackUsed?: boolean;
  sessionInfo?: any;
  sessionRepairNeeded?: boolean;
}

// Define window.__tempRegistrationData to avoid TypeScript errors
declare global {
  interface Window {
    __tempRegistrationData?: {
      timestamp: number;
      username: string;
    };
  }
}

/**
 * Enhanced detection of auto-logout patterns
 * This helps prevent unwanted rapid logouts that might be occurring due to bugs
 * Includes special protection for problematic users based on username patterns
 * @returns true if auto-logout pattern is detected, false otherwise
 */
export function detectAutoLogoutPattern(): boolean {
  try {
    // We now apply consistent session protection to all users without special cases
    
    // Standard auto-logout detection for all users
    const recentLogoutsJSON = localStorage.getItem('movietracker_recent_logouts');
    let recentLogouts: {timestamp: number, count: number, patterns?: string[]} = recentLogoutsJSON ? 
      JSON.parse(recentLogoutsJSON) : { timestamp: 0, count: 0, patterns: [] };
    
    // Initialize patterns array if it doesn't exist
    if (!recentLogouts.patterns) {
      recentLogouts.patterns = [];
    }
    
    // Get the current URL and referrer for pattern analysis
    const currentUrl = window.location.href;
    const referrer = document.referrer;
    
    // Record this pattern for analysis
    const pattern = `${currentUrl} <- ${referrer}`;
    recentLogouts.patterns.push(pattern);
    
    // Limit pattern history to latest 5 entries
    if (recentLogouts.patterns.length > 5) {
      recentLogouts.patterns = recentLogouts.patterns.slice(-5);
    }
    
    // Check if we have multiple rapid logout attempts
    const now = Date.now();
    
    // More selective timeframe - consider only very rapid logout attempts (15 seconds)
    const withinTimeWindow = (now - recentLogouts.timestamp) < 15000; // 15 seconds
    
    // Check if this is a test user (to avoid false positives for regular users)
    const cachedUser = localStorage.getItem('movietracker_user');
    let isTestUser = false;
    let cachedUsername = '';
    
    if (cachedUser) {
      try {
        const userData = JSON.parse(cachedUser);
        cachedUsername = userData?.username || '';
        isTestUser = cachedUsername.toLowerCase().includes('test');
      } catch (e) {
        console.error('Error parsing cached user:', e);
      }
    }
    
    if (withinTimeWindow) {
      // Increment the counter for tracking
      recentLogouts.count++;
      recentLogouts.timestamp = now;
      
      // Save it back to localStorage
      localStorage.setItem('movietracker_recent_logouts', JSON.stringify(recentLogouts));
      
      // Determine threshold based on user - special test users get extra protection
      const isSpecialTestUser = cachedUsername && ['test30', 'test36', 'janes'].some(name => 
        cachedUsername.toLowerCase() === name);
      
      // Lower threshold for special test users (catches issues faster)
      // Standard threshold for all other users (avoid false positives)
      const threshold = isSpecialTestUser ? 2 : 4;
      
      if (recentLogouts.count >= threshold) {
        console.warn(`Detected potential auto-logout pattern: ${recentLogouts.count} attempts in 15s for ${isTestUser ? 'test user' : 'regular user'}`);
        console.warn('Navigation patterns:', recentLogouts.patterns);
        console.warn('Username:', cachedUsername);
        
        // Record the detection for diagnostics
        localStorage.setItem('movietracker_auto_logout_detected', 'true');
        localStorage.setItem('movietracker_auto_logout_ts', String(now));
        localStorage.setItem('movietracker_auto_logout_count', String(recentLogouts.count));
        localStorage.setItem('movietracker_auto_logout_patterns', JSON.stringify(recentLogouts.patterns));
        if (cachedUsername) {
          localStorage.setItem('movietracker_auto_logout_username', cachedUsername);
        }
        
        return true;
      }
    } else {
      // Reset the counter if outside time window, but keep the patterns for debugging
      recentLogouts = { 
        timestamp: now, 
        count: 1,
        patterns: recentLogouts.patterns || []
      };
      localStorage.setItem('movietracker_recent_logouts', JSON.stringify(recentLogouts));
    }
    
    // Check for specific URL patterns known to cause issues
    const problematicPatterns = [
      { source: '/watchlist', destination: '/auth' },
      { source: '/search', destination: '/auth' }
    ];
    
    // Parse the current URL and referrer to check for problematic patterns
    const currentPath = new URL(currentUrl).pathname;
    const referrerPath = referrer ? new URL(referrer).pathname : '';
    
    for (const pattern of problematicPatterns) {
      if (currentPath.includes(pattern.destination) && referrerPath.includes(pattern.source)) {
        console.warn(`Detected problematic navigation pattern: ${pattern.source} -> ${pattern.destination}`);
        localStorage.setItem('movietracker_problematic_navigation', 'true');
        localStorage.setItem('movietracker_problematic_navigation_ts', String(now));
        return true;
      }
    }
    
    return false;
  } catch (e) {
    console.error("Error checking for auto-logout pattern:", e);
    return false;
  }
}

/**
 * Check the current session status with a single direct API call
 * Returns session status information or null if check fails
 */
export async function checkSessionStatus(): Promise<SessionCheckResult | null> {
  // Record start time for performance logging
  const startTime = performance.now();
  const sessionUrl = "/api/session";
  
  console.log('Session check starting:', new Date().toISOString());
  console.log('Primary endpoint:', sessionUrl);
  
  try {
    // Make a single direct call to the session endpoint
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
    
    if (sessionResponse.ok) {
      try {
        // Parse response if possible
        const sessionData = await sessionResponse.json();
        console.log('Session check successful:', sessionData);
        return sessionData;
      } catch (parseError) {
        console.error('Error parsing session response:', parseError);
        return null;
      }
    } else {
      console.error(`Session check failed with status: ${sessionResponse.status}`);
      return null;
    }
  } catch (error) {
    console.error('Network error during session check:', error);
    return null;
  } finally {
    // Log performance metrics for monitoring
    const endTime = performance.now();
    const duration = endTime - startTime;
    console.log(`Session check completed in ${duration.toFixed(2)}ms`);
  }
}

/**
 * Attempt to recover a broken session using server recovery mechanisms
 * This implements multiple recovery strategies to try to restore a session
 * without requiring the user to log in again
 * 
 * @param userId Optional user ID to try to recover specifically
 * @param username Optional username to try to recover specifically
 * @returns A promise that resolves to the recovery result
 */
export async function attemptSessionRecovery(userId?: number, username?: string): Promise<SessionCheckResult | null> {
  // DISABLED: Session auto-recovery has been disabled to prevent unwanted authentication
  console.log('[SESSION-RECOVERY] Session auto-recovery is disabled');
  return null;
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
  
  // Check for auto-logout patterns first - highest priority protection
  if (detectAutoLogoutPattern()) {
    console.warn('Auto-logout pattern detected during session expiration handling');
    
    // Check if we've shown this message recently to avoid spamming
    const lastToastTime = localStorage.getItem('movietracker_auto_logout_toast_time');
    const now = Date.now();
    let showToast = true;
    if (lastToastTime) {
      const lastTime = parseInt(lastToastTime);
      showToast = (now - lastTime) > 60000; // Only show once per minute
    }
    
    if (showToast) {
      // Store the toast time
      localStorage.setItem('movietracker_auto_logout_toast_time', String(now));
      
      // Show a user-friendly message about the issue
      toast({
        title: "Login session issue detected",
        description: "We detected an issue with your login session. Please try refreshing the page or logging in again.",
        variant: "destructive",
        duration: 7000
      });
    }
    
    // Log this in case we need to debug
    console.warn('Auto-logout handled, toast shown:', showToast);
    
    // No need to redirect immediately - let the user see the error
    return;
  }
  
  // Generic session handling for standard expiration cases
  try {
    // Show the generic "your session has expired" message
    toast({
      title: "Session expired",
      description: errorMessage || "Your session has expired. Please log in again.",
      variant: "destructive",
      duration: 5000
    });
    
    // Clean up any login state
    queryClient.setQueryData(['/api/user'], null);
    
    // Redirect to login page after a short delay
    setTimeout(() => {
      window.location.href = '/auth';
    }, redirectDelay);
  } catch (error) {
    console.error('Error during session expiration handling:', error);
    
    // Make sure we always redirect to login in case of errors
    setTimeout(() => {
      window.location.href = '/auth';
    }, redirectDelay + 1000);
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
  errorMessage: string;
} {
  // Default result assuming not an auth error
  const result = {
    isAuthError: false,
    isNetworkError: false,
    errorType: 'other_error' as ErrorType,
    errorMessage: ''
  };
  
  // Handle cases where error is null or undefined
  if (!error) {
    return result;
  }
  
  try {
    // Try to extract detailed error information
    
    // Case 1: Error is a response object with status code
    if (error.status === 401 || error.status === 403) {
      result.isAuthError = true;
      result.errorType = 'auth_error';
      result.errorMessage = `${error.status}: ${error.data?.message || 'unauthorized'}`;
      return result;
    }
    
    // Case 2: Network errors
    if (error.message && (
      error.message.includes('network') || 
      error.message.includes('Network') ||
      error.message.includes('Failed to fetch')
    )) {
      result.isNetworkError = true;
      result.errorType = 'network_error';
      result.errorMessage = error.message;
      return result;
    }
    
    // Case 3: API error with data property containing auth error messages
    if (error.data) {
      const errorData = error.data;
      if (
        errorData.message && (
          errorData.message.includes('authent') ||
          errorData.message.includes('Authent') ||
          errorData.message.includes('authorized') ||
          errorData.message.includes('Authorized') ||
          errorData.message.includes('login') ||
          errorData.message.includes('Login') ||
          errorData.message.includes('session') ||
          errorData.message.includes('Session')
        )
      ) {
        result.isAuthError = true;
        result.errorType = 'auth_error';
        result.errorMessage = errorData.message;
        return result;
      }
    }
    
    // Case 4: Direct error message contains auth-related terms
    if (error.message) {
      const message = error.message.toLowerCase();
      if (
        message.includes('unauthorized') ||
        message.includes('unauthenticated') ||
        message.includes('auth') ||
        message.includes('session') ||
        message.includes('login') ||
        message.includes('401') ||
        message.includes('403')
      ) {
        result.isAuthError = true;
        result.errorType = 'auth_error';
        result.errorMessage = error.message;
        return result;
      }
    }
    
    console.log('[API] Detected potential auth error:', result);
    
    // If we couldn't classify the error, return the default
    return result;
    
  } catch (e) {
    console.error('Error checking session error:', e);
    return result;
  }
}

/**
 * Legacy version for backward compatibility
 * @deprecated Use the detailed version instead
 */
export function isSessionErrorOld(error: any): boolean {
  return isSessionError(error).isAuthError;
}