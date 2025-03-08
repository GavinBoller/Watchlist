import { UserResponse } from '@shared/schema';
import { apiRequest } from './queryClient';
import { saveToken } from './jwtUtils';

/**
 * Production-safe registration function that uses the simplified registration endpoint
 * This provides a more robust alternative to the standard registration flow
 */
export async function simpleRegister(userData: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: UserResponse, token: string }> {
  console.log('[SIMPLE AUTH] Attempting registration with simplified endpoint');
  
  try {
    const response = await apiRequest('POST', '/api/simple-register', userData);
    const data = await response.json();
    
    if (!response.ok) {
      console.error('[SIMPLE AUTH] Registration failed:', data);
      throw new Error(data.error || 'Registration failed');
    }
    
    console.log('[SIMPLE AUTH] Registration successful');
    
    // Save the token if it was provided
    if (data.token) {
      saveToken(data.token);
    }
    
    return data;
  } catch (error) {
    console.error('[SIMPLE AUTH] Registration error:', error);
    throw error;
  }
}

/**
 * Check if simplified registration should be used based on environment or other factors
 * This helps us determine when to use the more robust registration flow
 */
export function shouldUseSimpleRegistration(): boolean {
  // Check for production environment
  const isProd = import.meta.env.PROD;
  
  // Check for any previous registration failures stored in localStorage
  const hasFailedRegistration = localStorage.getItem('registration_failure') === 'true';
  
  // Always use simple registration in production for reliability
  if (isProd) {
    return true;
  }
  
  // Use simple registration if a previous registration attempt failed
  if (hasFailedRegistration) {
    return true;
  }
  
  // By default, use the standard registration flow in development
  return false;
}