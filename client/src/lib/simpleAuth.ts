import { UserResponse } from '@shared/schema';
import { apiRequest } from './queryClient';
import { saveToken } from './jwtUtils';
import { isProductionEnvironment } from './environment-utils';

// Define primary and fallback registration endpoints
const REGISTRATION_ENDPOINTS = [
  '/api/simple-register',  // Primary endpoint for production
  '/api/jwt/register'      // Fallback endpoint
];

/**
 * Simplified registration function that works reliably in all environments
 * 
 * This provides a straightforward registration process that works consistently
 * across production and development environments.
 */
export async function simpleRegister(userData: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: UserResponse, token: string }> {
  console.log('[SIMPLE AUTH] Attempting registration with simplified flow');
  
  try {
    const isProd = isProductionEnvironment();
    console.log(`[SIMPLE AUTH] Environment: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'}`);
    console.log(`[SIMPLE AUTH] Registering user: ${userData.username}`);
    
    // Choose which endpoint to use based on environment
    const endpoint = isProd ? REGISTRATION_ENDPOINTS[0] : REGISTRATION_ENDPOINTS[1];
    console.log(`[SIMPLE AUTH] Using registration endpoint: ${endpoint}`);
    
    // Format the request data based on the endpoint
    const requestData = endpoint === '/api/jwt/register' 
      ? { ...userData, confirmPassword: userData.password } 
      : userData;
    
    // Make the API request
    const response = await apiRequest('POST', endpoint, requestData);
    
    if (!response.ok) {
      // If the primary endpoint fails and we have a fallback, try that
      if (endpoint !== REGISTRATION_ENDPOINTS[1]) {
        console.log(`[SIMPLE AUTH] Primary endpoint failed, trying fallback endpoint: ${REGISTRATION_ENDPOINTS[1]}`);
        
        const fallbackData = { 
          ...userData, 
          confirmPassword: userData.password 
        };
        
        const fallbackResponse = await apiRequest('POST', REGISTRATION_ENDPOINTS[1], fallbackData);
        
        if (!fallbackResponse.ok) {
          const errorText = await fallbackResponse.text().catch(() => 'Unknown error');
          throw new Error(`Registration failed: ${errorText}`);
        }
        
        const responseJson = await fallbackResponse.json();
        
        // Save the token if it was provided
        if (responseJson.token) {
          saveToken(responseJson.token);
        }
        
        return { 
          user: responseJson.user, 
          token: responseJson.token || '' 
        };
      }
      
      // If we have no fallback or we're already on the fallback, throw an error
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Registration failed: ${errorText}`);
    }
    
    // Process successful response
    const responseJson = await response.json();
    
    // Save the token if it was provided
    if (responseJson.token) {
      saveToken(responseJson.token);
      console.log('[SIMPLE AUTH] JWT token saved successfully');
    }
    
    return { 
      user: responseJson.user || responseJson, 
      token: responseJson.token || '' 
    };
  } catch (error) {
    console.error('[SIMPLE AUTH] Registration failed:', error);
    throw error;
  }
}

/**
 * Determine if we should use the simplified registration flow
 * In production, we always use the simpler approach for reliability
 */
export function shouldUseSimpleRegistration(): boolean {
  return isProductionEnvironment();
}