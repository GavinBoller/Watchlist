/**
 * JWT Utilities for client-side authentication
 * Streamlined version for cross-environment compatibility
 */

import { UserResponse } from '@shared/schema';

// Local storage key for JWT token
export const JWT_TOKEN_KEY = 'jwt_token';

/**
 * Save JWT token to localStorage 
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