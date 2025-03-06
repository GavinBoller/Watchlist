/**
 * JWT Utilities for client-side authentication
 */

import { UserResponse } from '@shared/schema';

// Local storage key for JWT token
export const JWT_TOKEN_KEY = 'jwt_token';

/**
 * Save JWT token to localStorage
 */
export const saveToken = (token: string): void => {
  localStorage.setItem(JWT_TOKEN_KEY, token);
};

/**
 * Get JWT token from localStorage
 */
export const getToken = (): string | null => {
  return localStorage.getItem(JWT_TOKEN_KEY);
};

/**
 * Remove JWT token from localStorage
 */
export const removeToken = (): void => {
  localStorage.removeItem(JWT_TOKEN_KEY);
};

/**
 * Check if user is authenticated with JWT
 */
export const isAuthenticated = (): boolean => {
  return !!getToken();
};

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
  
  if (!token) return null;
  
  try {
    // Get the payload part of the JWT (second part)
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error('Failed to parse user from token:', error);
    return null;
  }
};