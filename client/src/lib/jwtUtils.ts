/**
 * JWT Utilities for client-side authentication
 * Streamlined version for cross-environment compatibility
 * Enhanced with robust logout detection
 */

// Add TypeScript interface for window global state
declare global {
  interface Window {
    __loggedOut?: boolean;
  }
}

import { UserResponse } from '@shared/schema';

// Local storage key for JWT token
export const JWT_TOKEN_KEY = 'jwt_token';

/**
 * Shared helper to check if a user has recently logged out
 * Also clears logout flags if a valid token is found
 */
export function checkForLogoutFlags(): boolean {
  try {
    // Check all possible logout indicators
    const localStorageFlag = localStorage.getItem('just_logged_out') === 'true';
    const sessionStorageFlag = sessionStorage.getItem('just_logged_out') === 'true';
    const globalFlag = typeof window !== 'undefined' && window.__loggedOut === true;
    
    // If token exists but logout flag is set, clear the logout flag
    // This helps with automatic recovery when a token is valid
    const token = localStorage.getItem(JWT_TOKEN_KEY);
    if (token && token.split('.').length === 3 && (localStorageFlag || sessionStorageFlag || globalFlag)) {
      console.log('[JWT] Valid token found, clearing logout flags');
      localStorage.removeItem('just_logged_out');
      sessionStorage.removeItem('just_logged_out');
      if (typeof window !== 'undefined') {
        window.__loggedOut = false;
      }
      return false;
    }
    
    return localStorageFlag || sessionStorageFlag || globalFlag;
  } catch (e) {
    console.error('[JWT] Error checking logout state:', e);
    return false;
  }
}

/**
 * Save JWT token to localStorage with multiple backup mechanisms
 */
export const saveToken = (token: string): void => {
  if (!token) {
    console.error('[JWT] Attempted to save empty token');
    return;
  }
  
  try {
    // First clear any existing tokens that might be causing issues
    localStorage.removeItem(JWT_TOKEN_KEY);
    
    // Clear all logout flags when saving a token
    // This ensures that when a user logs in, we don't mistakenly treat them as logged out
    try {
      localStorage.removeItem('just_logged_out');
      sessionStorage.removeItem('just_logged_out');
      if (typeof window !== 'undefined') {
        window.__loggedOut = false;
      }
      console.log('[JWT] Logout flags cleared on token save');
    } catch (flagError) {
      console.error('[JWT] Error clearing logout flags:', flagError);
    }
    
    // Store the token
    localStorage.setItem(JWT_TOKEN_KEY, token);
    
    // Store backup copies in multiple locations
    localStorage.setItem('movietracker_token_backup', token);
    localStorage.setItem('movietracker_token_timestamp', Date.now().toString());
    
    // Store backup in session storage too
    try {
      sessionStorage.setItem(JWT_TOKEN_KEY, token);
      sessionStorage.setItem('movietracker_token_backup', token);
    } catch (sessionError) {
      console.error('[JWT] Failed to save token to sessionStorage:', sessionError);
    }
    
    // Use document.cookie as a last resort (less secure but useful as final backup)
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      document.cookie = `jwt_token_backup=${token}; expires=${tomorrow.toUTCString()}; path=/`;
    } catch (cookieError) {
      console.error('[JWT] Failed to save token to cookie:', cookieError);
    }
    
    console.log('[JWT] Token saved to localStorage and backups created');
  } catch (error) {
    console.error('[JWT] Failed to save token to localStorage:', error);
    
    // If localStorage fails, try sessionStorage as primary
    try {
      sessionStorage.setItem(JWT_TOKEN_KEY, token);
      console.log('[JWT] Token saved to sessionStorage (fallback)');
    } catch (sessionError) {
      console.error('[JWT] Failed to save token to sessionStorage:', sessionError);
    }
  }
};

/**
 * Get JWT token from localStorage with validation and fallback recovery
 */
export const getToken = (): string | null => {
  // Check for logout flag - this will also clear the flag if we have a valid token
  if (checkForLogoutFlags()) {
    console.log('[JWT] User recently logged out - not attempting token recovery');
    return null;
  }
  
  // Try primary storage location first
  let token = null;
  
  try {
    token = localStorage.getItem(JWT_TOKEN_KEY);
  } catch (localError) {
    console.error('[JWT] Error accessing localStorage:', localError);
  }
  
  if (!token) {
    console.log('[JWT] Token not found in primary storage, checking backups...');
    
    // Check if we are on the auth page - if we are, don't recover tokens
    const isOnAuthPage = window.location.pathname === '/auth' || 
                         window.location.pathname.includes('/login') ||
                         window.location.pathname.includes('/register');
                         
    if (isOnAuthPage) {
      console.log('[JWT] On auth page - skipping token recovery for security');
      return null;
    }
    
    // Try backup locations in localStorage
    try {
      token = localStorage.getItem('movietracker_token_backup');
      if (token) {
        console.log('[JWT] Recovered token from backup in localStorage');
        // Restore to primary location
        saveToken(token);
        return token;
      }
    } catch (backupError) {
      console.error('[JWT] Error accessing localStorage backup:', backupError);
    }
    
    // Try sessionStorage
    try {
      token = sessionStorage.getItem(JWT_TOKEN_KEY) || sessionStorage.getItem('movietracker_token_backup');
      if (token) {
        console.log('[JWT] Recovered token from sessionStorage');
        // Restore to localStorage
        saveToken(token);
        return token;
      }
    } catch (sessionError) {
      console.error('[JWT] Error accessing sessionStorage:', sessionError);
    }
    
    // Try cookie as last resort
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'jwt_token_backup' && value) {
          console.log('[JWT] Recovered token from cookie');
          token = value;
          saveToken(token);
          return token;
        }
      }
    } catch (cookieError) {
      console.error('[JWT] Error accessing cookies:', cookieError);
    }
    
    return null;
  }
  
  // Validate the token we found
  try {
    // Quick validation - verify it has 3 parts
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[JWT] Retrieved invalid token format from storage');
      removeToken();
      
      // Try backup locations recursively (but prevent infinite loop)
      removeToken(); // Clear the bad token first
      console.log('[JWT] Invalid token format, trying backups...');
      const backupToken = getBackupToken();
      return backupToken;
    }
    
    return token;
  } catch (error) {
    console.error('[JWT] Error validating stored token:', error);
    removeToken();
    return null;
  }
};

/**
 * Helper function to get token from backup locations only
 * This is separate to prevent infinite recursion in getToken
 */
function getBackupToken(): string | null {
  // Check for logout flag using shared function
  if (checkForLogoutFlags()) {
    console.log('[JWT] User recently logged out - not attempting backup token recovery');
    return null;
  }
  
  // Check if we are on the auth page - if we are, don't recover tokens
  const isOnAuthPage = window.location.pathname === '/auth' || 
                       window.location.pathname.includes('/login') ||
                       window.location.pathname.includes('/register');
                       
  if (isOnAuthPage) {
    console.log('[JWT] On auth page - skipping backup token recovery for security');
    return null;
  }
  
  let token = null;
  
  // Try backup locations in localStorage
  try {
    token = localStorage.getItem('movietracker_token_backup');
    if (token && isValidJwtFormat(token)) {
      console.log('[JWT] Recovered valid token from backup in localStorage');
      // Restore to primary location
      localStorage.setItem(JWT_TOKEN_KEY, token);
      return token;
    }
  } catch (backupError) {
    console.error('[JWT] Error accessing localStorage backup:', backupError);
  }
  
  // Try sessionStorage
  try {
    const sessionToken = sessionStorage.getItem(JWT_TOKEN_KEY) || sessionStorage.getItem('movietracker_token_backup');
    if (sessionToken && isValidJwtFormat(sessionToken)) {
      console.log('[JWT] Recovered valid token from sessionStorage');
      // Restore to localStorage
      localStorage.setItem(JWT_TOKEN_KEY, sessionToken);
      return sessionToken;
    }
  } catch (sessionError) {
    console.error('[JWT] Error accessing sessionStorage:', sessionError);
  }
  
  // Try cookie as last resort
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'jwt_token_backup' && value && isValidJwtFormat(value)) {
        console.log('[JWT] Recovered valid token from cookie');
        localStorage.setItem(JWT_TOKEN_KEY, value);
        return value;
      }
    }
  } catch (cookieError) {
    console.error('[JWT] Error accessing cookies:', cookieError);
  }
  
  return null;
}

/**
 * Helper to check if a string has the basic JWT format
 */
function isValidJwtFormat(token: string): boolean {
  try {
    const parts = token.split('.');
    return parts.length === 3;
  } catch (e) {
    return false;
  }
}

/**
 * Remove JWT token from all storage locations
 */
export const removeToken = (): void => {
  try {
    // Clear primary storage locations
    localStorage.removeItem(JWT_TOKEN_KEY);
    sessionStorage.removeItem(JWT_TOKEN_KEY);
    
    // Clear known backup locations
    localStorage.removeItem('movietracker_token_backup');
    localStorage.removeItem('movietracker_token_timestamp');
    sessionStorage.removeItem('movietracker_token_backup');
    
    // Clear cookie backups
    document.cookie = `${JWT_TOKEN_KEY}=; path=/; max-age=0`;
    document.cookie = `jwt_token_backup=; path=/; max-age=0`;
    
    // Set the logout flags to prevent automatic token recovery
    try {
      localStorage.setItem('just_logged_out', 'true');
      sessionStorage.setItem('just_logged_out', 'true');
      if (typeof window !== 'undefined') {
        window.__loggedOut = true;
      }
      console.log('[JWT] Logout flags set to prevent token recovery');
    } catch (flagError) {
      console.error('[JWT] Error setting logout flags:', flagError);
    }
    
    // Clear any additional JWT-related storage items
    const backupKeys = [
      'jwt_token_backup',
      'jwt_backup',
      'auth_token',
      'auth_backup',
      'token_backup',
      'user_token',
      'user_session'
    ];
    
    // Clear from both storage types
    backupKeys.forEach(key => {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {
        // Ignore individual key errors
      }
    });
    
    // Aggressively scan for other token-related keys
    try {
      // For localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.includes('token') || 
          key.includes('auth') || 
          key.includes('jwt') || 
          key.includes('user')
        )) {
          localStorage.removeItem(key);
        }
      }
      
      // For sessionStorage
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (
          key.includes('token') || 
          key.includes('auth') || 
          key.includes('jwt') || 
          key.includes('user')
        )) {
          sessionStorage.removeItem(key);
        }
      }
    } catch (e) {
      console.error('[JWT] Error during storage scan:', e);
    }
    
    console.log('[JWT] Token removed from all storage locations');
  } catch (error) {
    console.error('[JWT] Error removing token:', error);
  }
};

/**
 * Refresh token if it's close to expiration
 * This proactively refreshes tokens that are within the buffer window
 */
export const refreshTokenIfNeeded = async (): Promise<boolean> => {
  const token = getToken();
  if (!token) return false;
  
  try {
    const payload = parsePayloadFromToken(token);
    if (!payload || !payload.exp) return false;
    
    const currentTime = Date.now() / 1000;
    const timeUntilExpiry = payload.exp - currentTime;
    
    // In production, we refresh tokens that are close to expiring
    // In development, we use a longer buffer time
    const isProd = window.location.hostname.includes('replit.app');
    const REFRESH_BUFFER_SECONDS = isProd ? 12 * 60 * 60 : 24 * 60 * 60; // 12 hours in prod, 24 hours in dev
    
    if (timeUntilExpiry < REFRESH_BUFFER_SECONDS) {
      console.log(`[JWT] Token will expire in ${Math.round(timeUntilExpiry / 60)} minutes, refreshing... (${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} mode)`);
      
      try {
        // Call token refresh endpoint with retry logic
        const maxRetries = isProd ? 3 : 1;
        let retryCount = 0;
        let refreshed = false;
        
        while (retryCount < maxRetries && !refreshed) {
          try {
            const response = await fetch('/api/jwt/refresh', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.token) {
                saveToken(data.token);
                console.log('[JWT] Token refreshed successfully');
                refreshed = true;
                return true;
              }
            } else {
              console.warn(`[JWT] Failed to refresh token, status: ${response.status} (attempt ${retryCount + 1}/${maxRetries})`);
            }
          } catch (retryError) {
            console.error(`[JWT] Error refreshing token (attempt ${retryCount + 1}/${maxRetries}):`, retryError);
          }
          
          retryCount++;
          if (retryCount < maxRetries) {
            // Wait before retry (exponential backoff)
            const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
            console.log(`[JWT] Retrying token refresh in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
          }
        }
      } catch (refreshError) {
        console.error('[JWT] Error in refresh process:', refreshError);
      }
    }
    
    return false;
  } catch (error) {
    console.error('[JWT] Error checking token expiration:', error);
    return false;
  }
};

/**
 * Check if user is authenticated with JWT with validation
 * Includes attempt to refresh token if needed
 */
export const isAuthenticated = async (): Promise<boolean> => {
  const token = getToken();
  if (!token) return false;
  
  try {
    // Decode the token to check expiration
    const payload = parsePayloadFromToken(token);
    if (!payload || !payload.exp) {
      console.error('[JWT] Token is missing expiration data');
      removeToken();
      return false;
    }
    
    const currentTime = Date.now() / 1000;
    
    // Check if token is expired
    if (payload.exp < currentTime) {
      console.log('[JWT] Token is expired, removing from localStorage');
      removeToken();
      return false;
    }
    
    // If token is valid but close to expiry, try to refresh it
    // This happens in the background and doesn't affect the current authentication check
    const REFRESH_BUFFER_SECONDS = 24 * 60 * 60; // 24 hours
    if (payload.exp - currentTime < REFRESH_BUFFER_SECONDS) {
      // Don't await - let it happen in the background
      refreshTokenIfNeeded().catch(error => {
        console.error('[JWT] Background token refresh failed:', error);
      });
    }
    
    return true;
  } catch (error) {
    console.error('[JWT] Error validating token authentication:', error);
    removeToken();
    return false;
  }
};

/**
 * Internal helper to parse JWT payload
 */
function parsePayloadFromToken(token: string): any {
  try {
    // Get the payload part of the JWT (second part)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.error('[JWT] Invalid token format - not three parts');
      return null;
    }
    
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('[JWT] Failed to parse token payload:', error);
    return null;
  }
}

/**
 * Set authentication headers for axios
 */
export const setAuthHeader = (headers: Record<string, string> = {}): Record<string, string> => {
  const token = getToken();
  if (token) {
    return {
      ...headers,
      'Authorization': `Bearer ${token}`
    };
  }
  return headers;
};

/**
 * Parse user from token
 */
export const parseUserFromToken = (): UserResponse | null => {
  const token = getToken();
  
  if (!token) {
    return null;
  }
  
  try {
    const payload = parsePayloadFromToken(token);
    
    // Validate payload has required fields
    if (!payload || !payload.id || !payload.username) {
      console.error('[JWT] Invalid token payload - missing required fields');
      removeToken(); // Clear invalid token
      return null;
    }
    
    return payload;
  } catch (error) {
    console.error('[JWT] Failed to parse user from token:', error);
    removeToken(); // Clear invalid token
    return null;
  }
};