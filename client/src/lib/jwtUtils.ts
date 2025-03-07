/**
 * JWT Utilities for client-side authentication
 */

import { UserResponse } from '@shared/schema';

// Local storage key for JWT token
export const JWT_TOKEN_KEY = 'jwt_token';
export const TOKEN_RENEWAL_THRESHOLD = 12 * 60 * 60; // 12 hours in seconds

/**
 * Save JWT token to localStorage with improved backup
 */
export const saveToken = (token: string): void => {
  if (!token) {
    console.error('[JWT] Attempted to save empty token');
    return;
  }
  
  try {
    // Store the token
    localStorage.setItem(JWT_TOKEN_KEY, token);
    console.log('[JWT] Token saved to localStorage');
    
    // Also decode and save user info as a backup
    const parsedUser = parsePayloadFromToken(token);
    if (parsedUser) {
      // Store backup user info in localStorage for emergency fallback
      localStorage.setItem('backup_user_id', parsedUser.id.toString());
      localStorage.setItem('backup_username', parsedUser.username);
      localStorage.setItem('backup_user_json', JSON.stringify(parsedUser));
      console.log('[JWT] Backup user data saved for:', parsedUser.username);
    }
  } catch (error) {
    console.error('[JWT] Failed to save token:', error);
  }
};

/**
 * Get JWT token from localStorage with validation
 */
export const getToken = (): string | null => {
  const token = localStorage.getItem(JWT_TOKEN_KEY);
  
  if (token) {
    try {
      // Quick validation - verify it has 3 parts
      const parts = token.split('.');
      if (parts.length !== 3) {
        console.error('[JWT] Retrieved invalid token format from storage');
        removeToken();
        return null;
      }
      
      return token;
    } catch (error) {
      console.error('[JWT] Error validating stored token:', error);
      removeToken();
      return null;
    }
  }
  
  return null;
};

/**
 * Remove JWT token and backup data from localStorage
 */
export const removeToken = (): void => {
  localStorage.removeItem(JWT_TOKEN_KEY);
  localStorage.removeItem('backup_user_id');
  localStorage.removeItem('backup_username');
  localStorage.removeItem('backup_user_json');
  console.log('[JWT] Token and backup data removed from localStorage');
};

/**
 * Check if user is authenticated with JWT with additional validation
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
    
    // Check if token expires soon (within threshold)
    if (payload.exp - currentTime < TOKEN_RENEWAL_THRESHOLD) {
      console.log('[JWT] Token will expire soon, flagging for renewal');
      localStorage.setItem('jwt_token_needs_renewal', 'true');
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
 * Parse user from token - for emergency situations where API is down
 * This is a fallback mechanism to retrieve basic user info from JWT
 */
export const parseUserFromToken = (): UserResponse | null => {
  const token = getToken();
  
  if (!token) {
    // Try to get from backup
    try {
      const backupUserJson = localStorage.getItem('backup_user_json');
      if (backupUserJson) {
        const backupUser = JSON.parse(backupUserJson);
        console.log('[JWT] Using backup user data:', backupUser.username);
        return backupUser;
      }
      
      // Fall back to individual fields if full JSON not available
      const id = localStorage.getItem('backup_user_id');
      const username = localStorage.getItem('backup_username');
      
      if (id && username) {
        console.log('[JWT] Using backup user fields:', username);
        return {
          id: parseInt(id),
          username,
          displayName: username
        } as UserResponse;
      }
    } catch (error) {
      console.error('[JWT] Failed to parse backup user data:', error);
    }
    
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
    
    console.log('[JWT] Successfully parsed user from token:', payload.username);
    return payload;
  } catch (error) {
    console.error('[JWT] Failed to parse user from token:', error);
    removeToken(); // Clear invalid token
    return null;
  }
};

/**
 * Get a fresh emergency token from the server
 * This can be used when normal authentication fails
 */
export const getEmergencyToken = async (): Promise<{ token: string, user: UserResponse } | null> => {
  try {
    console.log('[JWT] Attempting to get emergency token');
    const response = await fetch('/api/jwt/emergency-token');
    
    if (!response.ok) {
      throw new Error(`Failed to get emergency token: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.token && data.user) {
      console.log('[JWT] Emergency token obtained successfully');
      saveToken(data.token);
      return { token: data.token, user: data.user };
    }
    
    throw new Error('Invalid emergency token response');
  } catch (error) {
    console.error('[JWT] Emergency token error:', error);
    return null;
  }
};