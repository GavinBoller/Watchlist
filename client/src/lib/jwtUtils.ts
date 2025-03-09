/**
 * JWT Utilities for client-side authentication
 * Streamlined version for cross-environment compatibility
 */

import { UserResponse } from '@shared/schema';

// Local storage key for JWT token
export const JWT_TOKEN_KEY = 'jwt_token';

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
  // Try primary storage location first
  let token = null;
  
  try {
    token = localStorage.getItem(JWT_TOKEN_KEY);
  } catch (localError) {
    console.error('[JWT] Error accessing localStorage:', localError);
  }
  
  if (!token) {
    console.log('[JWT] Token not found in primary storage, checking backups...');
    
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
 * Remove JWT token from localStorage
 */
export const removeToken = (): void => {
  localStorage.removeItem(JWT_TOKEN_KEY);
  console.log('[JWT] Token removed from localStorage');
};

/**
 * Check if user is authenticated with JWT with validation
 */
export const isAuthenticated = (): boolean => {
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