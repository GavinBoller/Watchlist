/**
 * Environment detection and environment-specific behaviors
 * This file consolidates environment-specific logic to ensure consistent behavior across our app
 */

/**
 * Detect if we're running in a production environment
 * @returns true if we're in production, false if we're in development
 */
// Track if we've already logged the environment
let hasLoggedEnvironment = false;

/**
 * Reliably detect production environment across different Replit deployments
 * This has been enhanced to detect more production indicators
 */
export function isProductionEnvironment(): boolean {
  // Check for various production indicators
  const isProdDomain = window.location.hostname.includes('replit.app');
  const isProdProtocol = window.location.protocol === 'https:';
  const hasReplitEnv = 'REPL_ID' in window || 'REPL_SLUG' in window || 'REPLIT_DEPLOYMENT' in window;
  const urlHasFlag = window.location.search.includes('env=production');
  
  // Combined check
  const isProd = isProdDomain || (isProdProtocol && hasReplitEnv) || urlHasFlag;
  
  // Log environment detection for debugging (only once)
  if (!hasLoggedEnvironment) {
    console.log(`[ENV] Detected ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} environment`);
    console.log(`[ENV] Hostname: ${window.location.hostname}`);
    console.log(`[ENV] Protocol: ${window.location.protocol}`);
    console.log(`[ENV] Indicators - Domain: ${isProdDomain}, Protocol: ${isProdProtocol}, ReplEnv: ${hasReplitEnv}, Flag: ${urlHasFlag}`);
    hasLoggedEnvironment = true;
  }
  
  return isProd;
}

/**
 * Get a user-friendly environment name for debugging
 * @returns String indicating current environment
 */
export function getEnvironmentName(): string {
  return isProductionEnvironment() ? 'PRODUCTION' : 'DEVELOPMENT';
}

/**
 * Clear all client-side storage with environment-specific behaviors
 * In production, we use a more aggressive approach to ensure complete clearance
 */
export function clearAllClientSideStorage(): void {
  const isProd = isProductionEnvironment();
  console.log(`Clearing all client-side storage in ${getEnvironmentName()} environment`);
  
  // 1. Mark intentional logout time to prevent auto-logout detection
  localStorage.setItem('movietracker_logout_time', Date.now().toString());
  
  // 2. Create a list of all potential app-specific localStorage keys
  const keysToRemove = [
    'movietracker_user', 
    'movietracker_session_id',
    'movietracker_enhanced_backup', 
    'movietracker_username',
    'movietracker_last_verified',
    'movietracker_session_heartbeat',
    'movietracker_recent_auth',
    'movietracker_auth_state',
    'movietracker_logout_detected',
    'movietracker_auto_logout_count',
    'tanstack-query-cache'
  ];
  
  // 3. Clear specific keys
  for (const key of keysToRemove) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Error removing localStorage key ${key}:`, e);
    }
  }
  
  // 4. In production, clear ALL localStorage
  if (isProd) {
    try {
      console.log('Production environment - clearing entire localStorage');
      localStorage.clear();
    } catch (e) {
      console.error('Error clearing localStorage:', e);
    }
  }
  
  // 5. Clear cookies using multiple techniques
  try {
    // Standard cookie clearing
    document.cookie.split(";").forEach(function(c) {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    
    // Production-specific extra cookie clearing with multiple paths
    if (isProd) {
      // Try explicit cookie paths (including root and sub-paths)
      ["watchlist.sid", "connect.sid", "session", "watchapp.sid"].forEach(name => {
        for (const path of ['/', '/auth', '/api', '/watchlist', '/search']) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path}`;
        }
      });
    }
  } catch (e) {
    console.error('Error clearing cookies:', e);
  }
}

/**
 * Create a custom logout solution based on environment
 * @returns Object with URLs and parameters for environment-specific logout
 */
export function getLogoutConfig(): {authUrl: string; params: Record<string, string>; useIframe: boolean} {
  const timestamp = Date.now();
  const isProd = isProductionEnvironment();
  
  // Base parameters for all environments
  const params: Record<string, string> = {
    force: 'true',
    t: timestamp.toString(),
    fromLogout: 'true'
  };
  
  // Production-specific parameters
  if (isProd) {
    params.clear = 'true';
    params.hard = 'true';
    
    return {
      authUrl: `/auth?force=true&t=${timestamp}&clear=true&hard=true`,
      params,
      useIframe: true // In production, use iframe technique
    };
  }
  
  // Development configuration
  return {
    authUrl: `/auth?force=true&t=${timestamp}`,
    params,
    useIframe: false
  };
}

/**
 * Format error messages for different environments
 * Production messages are more user-friendly and less technical
 */
export function formatErrorMessage(error: any): string {
  const isProd = isProductionEnvironment();
  
  if (!error) {
    return 'An unknown error occurred';
  }
  
  // Production uses simpler error messages
  if (isProd) {
    if (typeof error === 'string') {
      return error;
    }
    
    // For network or auth errors in production, provide friendly messages
    if (error.status === 401 || error.status === 403) {
      return 'Your session has expired. Please sign in again.';
    }
    
    if (error.status >= 500) {
      return 'The service is temporarily unavailable. Please try again later.';
    }
    
    return error.message || 'Something went wrong. Please try again.';
  }
  
  // Development shows more detailed errors
  if (typeof error === 'string') {
    return error;
  }
  
  return error.message || JSON.stringify(error);
}