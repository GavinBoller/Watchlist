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
    // Mark the start time for performance logging
    const startTime = Date.now();
    
    // Add tracking for production debugging
    const isProduction = import.meta.env.PROD;
    console.log(`[SIMPLE AUTH] Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`[SIMPLE AUTH] Registering user: ${userData.username}`);
    
    // Add retry logic for better reliability in production
    const maxRetries = isProduction ? 2 : 0;
    let lastError = null;
    let responseJson = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[SIMPLE AUTH] Retry attempt ${attempt}/${maxRetries}`);
          // Add increasing delay between retries
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
        
        // Make the API request
        const response = await apiRequest('POST', '/api/simple-register', userData);
        responseJson = await response.json();
        
        if (!response.ok) {
          console.error(`[SIMPLE AUTH] Registration attempt ${attempt + 1} failed:`, responseJson);
          
          // Check if it's a temporary error that we should retry
          if (responseJson.temporaryError && attempt < maxRetries) {
            lastError = new Error(responseJson.error || 'Temporary registration failure');
            continue; // Retry
          }
          
          // If it's a permanent error or we've run out of retries, throw
          throw new Error(responseJson.error || 'Registration failed');
        }
        
        // If we get here, the request was successful
        const elapsedTime = Date.now() - startTime;
        console.log(`[SIMPLE AUTH] Registration successful in ${elapsedTime}ms`);
        
        // Save the token if it was provided
        if (responseJson.token) {
          saveToken(responseJson.token);
          console.log('[SIMPLE AUTH] JWT token saved successfully');
        } else {
          console.warn('[SIMPLE AUTH] No token received from registration endpoint');
        }
        
        // Registration succeeded, exit the retry loop
        return responseJson;
      } catch (attemptError) {
        lastError = attemptError;
        console.error(`[SIMPLE AUTH] Error during registration attempt ${attempt + 1}:`, attemptError);
        
        // If this is not the last attempt, continue to the next iteration
        if (attempt < maxRetries) {
          continue;
        }
        
        // On the last attempt, rethrow the error to be caught by the outer catch
        throw attemptError;
      }
    }
    
    // This should never happen due to the loop structure, but TypeScript wants it
    throw lastError || new Error('Registration failed with no specific error');
  } catch (error) {
    console.error('[SIMPLE AUTH] Registration ultimately failed after all attempts:', error);
    
    // Store a flag to indicate we should try simple registration next time
    localStorage.setItem('registration_failure', 'true');
    
    // Rethrow to let the component handle the error
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