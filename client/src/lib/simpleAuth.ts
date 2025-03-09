import { UserResponse } from '@shared/schema';
import { apiRequest } from './queryClient';
import { saveToken } from './jwtUtils';
import { isProductionEnvironment } from './environment-utils';

// Define primary and fallback registration endpoints
const REGISTRATION_ENDPOINTS = [
  '/api/simple-register',  // Primary endpoint for production
  '/api/jwt/register'      // Fallback endpoint
];

// Helper function to safely parse response text
async function safeParseResponse(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const jsonData = await response.json();
        console.log('[SIMPLE AUTH] Error response data:', jsonData);
        
        // Format JSON error nicely
        if (jsonData.error) return jsonData.error;
        if (jsonData.message) return jsonData.message;
        return JSON.stringify(jsonData);
      } catch (e) {
        console.error('[SIMPLE AUTH] Failed to parse JSON response:', e);
      }
    }
    
    // Default to text if JSON fails or content-type is not JSON
    const text = await response.text();
    return text.slice(0, 100) + (text.length > 100 ? '...' : ''); // Truncate long responses
  } catch (e) {
    console.error('[SIMPLE AUTH] Failed to read response:', e);
    return 'Error reading server response';
  }
}

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
    
    // Always use alternate endpoint in production for now to bypass the error
    const endpoint = isProd ? REGISTRATION_ENDPOINTS[1] : REGISTRATION_ENDPOINTS[1];
    console.log(`[SIMPLE AUTH] Using registration endpoint: ${endpoint}`);
    
    // Format the request data appropriately (always use confirmPassword)
    const requestData = { 
      ...userData, 
      confirmPassword: userData.password 
    };
    
    try {
      // Make the API request with explicit fetch for better error handling
      const fetchOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify(requestData)
      };
      
      console.log(`[SIMPLE AUTH] Sending registration request to ${endpoint}`);
      const response = await fetch(endpoint, fetchOptions);
      console.log(`[SIMPLE AUTH] Registration response status: ${response.status}`);
      
      // Handle successful response
      if (response.ok) {
        const responseJson = await response.json();
        console.log('[SIMPLE AUTH] Registration successful, processing response');
        
        // Save the token if provided
        if (responseJson.token) {
          saveToken(responseJson.token);
          console.log('[SIMPLE AUTH] JWT token saved successfully');
        }
        
        // Extract user data from the response
        if (!responseJson.user && !responseJson.token) {
          console.warn('[SIMPLE AUTH] Response missing expected user or token properties:', responseJson);
        }
        
        return { 
          user: responseJson.user || responseJson, 
          token: responseJson.token || '' 
        };
      }
      
      // Handle error response
      const errorMessage = await safeParseResponse(response);
      const statusText = `${response.status}: ${response.statusText}`;
      console.error(`[SIMPLE AUTH] Registration failed with status ${statusText}, Message: ${errorMessage}`);
      
      throw new Error(`Registration Failed - ${statusText}: ${errorMessage}`);
    } catch (requestError) {
      // Let API errors propagate
      if (requestError instanceof Error && requestError.message.includes('Registration Failed')) {
        throw requestError;
      }
      
      // Try fallback if we haven't already
      if (endpoint !== REGISTRATION_ENDPOINTS[1]) {
        console.log(`[SIMPLE AUTH] Primary endpoint failed with error: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
        console.log(`[SIMPLE AUTH] Trying fallback endpoint: ${REGISTRATION_ENDPOINTS[1]}`);
        
        // Modified for fallback: use the standard JWT registration endpoint with appropriate data
        try {
          const fallbackData = { 
            ...userData, 
            confirmPassword: userData.password 
          };
          
          const fallbackOptions = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
            },
            body: JSON.stringify(fallbackData)
          };
          
          const fallbackResponse = await fetch(REGISTRATION_ENDPOINTS[1], fallbackOptions);
          console.log(`[SIMPLE AUTH] Fallback registration response status: ${fallbackResponse.status}`);
          
          if (!fallbackResponse.ok) {
            const errorText = await safeParseResponse(fallbackResponse);
            throw new Error(`Registration failed with fallback: ${fallbackResponse.status}: ${errorText}`);
          }
          
          const responseJson = await fallbackResponse.json();
          console.log('[SIMPLE AUTH] Fallback registration successful');
          
          // Save the token if it was provided
          if (responseJson.token) {
            saveToken(responseJson.token);
            console.log('[SIMPLE AUTH] JWT token saved from fallback endpoint');
          }
          
          return { 
            user: responseJson.user, 
            token: responseJson.token || '' 
          };
        } catch (fallbackError) {
          console.error('[SIMPLE AUTH] Fallback registration also failed:', fallbackError);
          throw new Error(`Registration failed with all attempts: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
      }
      
      // Fallback was already used or error wasn't related to API request
      throw new Error(`Registration failed: ${requestError instanceof Error ? requestError.message : String(requestError)}`);
    }
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
  return true; // Always use simple registration for consistency across environments
}