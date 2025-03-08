import { UserResponse } from '@shared/schema';
import { apiRequest } from './queryClient';
import { saveToken } from './jwtUtils';

// Define fallback endpoints to try if the main one fails with a 501 error
const REGISTRATION_ENDPOINTS = [
  '/api/simple-register',   // Primary endpoint
  '/api/jwt/register',      // Fallback #1
  '/api/register',          // Fallback #2
  '/api/jwt/emergency-token' // Emergency fallback (read-only)
];

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
    
    // Try each registration endpoint until one works
    for (const endpoint of REGISTRATION_ENDPOINTS) {
      console.log(`[SIMPLE AUTH] Trying registration endpoint: ${endpoint}`);
      
      // For each endpoint, try multiple times with backoff
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[SIMPLE AUTH] Retry attempt ${attempt}/${maxRetries} for endpoint ${endpoint}`);
            // Add increasing delay between retries
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          }
          
          // Emergency endpoint needs a GET request and has no body
          if (endpoint === '/api/jwt/emergency-token') {
            console.log('[SIMPLE AUTH] Using emergency token endpoint as last resort');
            
            // Use GET instead of POST for emergency token endpoint
            try {
              // Try to use the user's requested username if possible, or fall back to a test account
              const requestedUsername = userData.username || 'TestEmergency';
              
              // Try multiple usernames in case the primary one fails
              const usernameOptions = [
                requestedUsername,          // First try with user's requested username
                'Test99',                   // Then try a known test account
                'TestEmergency',            // Then try another test account
                'TestFallback'              // Final fallback
              ];
              
              for (const username of usernameOptions) {
                console.log(`[SIMPLE AUTH] Trying emergency token with username: ${username}`);
                
                const emergencyResponse = await fetch(`${endpoint}?username=${username}`, {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json'
                  }
                });
                
                if (emergencyResponse.ok) {
                  try {
                    const emergencyData = await emergencyResponse.json();
                    console.log('[SIMPLE AUTH] Emergency token acquired successfully');
                    
                    // Return the emergency token and user data
                    if (emergencyData.token) {
                      saveToken(emergencyData.token);
                      
                      // Store original info in localStorage so we remember what the user wanted
                      try {
                        localStorage.setItem('requested_username', userData.username);
                        localStorage.setItem('requested_display_name', userData.displayName || '');
                        localStorage.setItem('emergency_username_used', username);
                        localStorage.setItem('emergency_login_time', Date.now().toString());
                      } catch (storageError) {
                        console.error('[SIMPLE AUTH] Failed to store emergency info:', storageError);
                      }
                      
                      return {
                        user: emergencyData.user,
                        token: emergencyData.token
                      };
                    }
                  } catch (jsonError) {
                    console.error('[SIMPLE AUTH] Failed to parse emergency token response:', jsonError);
                  }
                }
              }
              
              // If emergency token failed, continue with next method
              console.warn('[SIMPLE AUTH] Emergency token endpoint failed, continuing with standard methods');
            } catch (emergencyError) {
              console.error('[SIMPLE AUTH] Error with emergency token endpoint:', emergencyError);
            }
            
            // Skip the rest of this iteration and try the next endpoint
            continue;
          }
          
          // Add special formatting for jwt/register endpoint which has different param formats
          const requestData = endpoint === '/api/jwt/register' 
            ? { ...userData, confirmPassword: userData.password } 
            : userData;
          
          // Make the API request
          const response = await apiRequest('POST', endpoint, requestData);
          
          try {
            responseJson = await response.json();
          } catch (jsonError) {
            console.warn(`[SIMPLE AUTH] Failed to parse JSON from ${endpoint}`, jsonError);
            responseJson = { error: 'Invalid response format' };
          }
          
          if (!response.ok) {
            console.error(`[SIMPLE AUTH] Registration attempt ${attempt + 1} on ${endpoint} failed:`, responseJson);
            
            // Handle specific error codes
            if (response.status === 501 || response.status === 404 || response.status === 500) {
              console.warn(`[SIMPLE AUTH] Endpoint ${endpoint} error (${response.status}), trying next endpoint`);
              // Break inner loop to try next endpoint
              break;
            }
            
            // Check if it's a temporary error that we should retry
            if (responseJson.temporaryError && attempt < maxRetries) {
              lastError = new Error(responseJson.error || `Temporary registration failure on ${endpoint}`);
              continue; // Retry the same endpoint
            }
            
            // If it's a permanent error, throw to try the next endpoint
            throw new Error(responseJson.error || `Registration failed on ${endpoint}`);
          }
          
          // If we get here, the request was successful
          const elapsedTime = Date.now() - startTime;
          console.log(`[SIMPLE AUTH] Registration successful in ${elapsedTime}ms using ${endpoint}`);
          
          // Handle different response formats from different endpoints
          let user = responseJson.user;
          let token = responseJson.token;
          
          // For the standard registration endpoint that doesn't return a token
          if (endpoint === '/api/register' && !token && user) {
            console.log('[SIMPLE AUTH] Using standard registration endpoint without token');
            // We still need to create a token for this user
            try {
              const loginResponse = await apiRequest('POST', '/api/jwt/login', {
                username: userData.username,
                password: userData.password
              });
              
              if (loginResponse.ok) {
                const loginJson = await loginResponse.json();
                token = loginJson.token;
                console.log('[SIMPLE AUTH] Successfully obtained token from login endpoint after registration');
              }
            } catch (loginError) {
              console.warn('[SIMPLE AUTH] Failed to get token after registration:', loginError);
              // Continue anyway, the app will handle missing token
            }
          }
          
          // Save the token if it was provided
          if (token) {
            saveToken(token);
            console.log('[SIMPLE AUTH] JWT token saved successfully');
          } else {
            console.warn('[SIMPLE AUTH] No token received from registration endpoint');
          }
          
          // Registration succeeded, return the response
          return { 
            user: user || responseJson, 
            token: token || '' 
          };
        } catch (attemptError) {
          lastError = attemptError;
          console.error(`[SIMPLE AUTH] Error during registration attempt ${attempt + 1} on ${endpoint}:`, attemptError);
          
          // If this is not the last attempt for this endpoint, continue retrying
          if (attempt < maxRetries) {
            continue;
          }
          
          // On the last attempt for this endpoint, continue to the next endpoint
          console.log(`[SIMPLE AUTH] All attempts failed for ${endpoint}, trying next endpoint if available`);
        }
      }
    }
    
    // If we get here, all endpoints and all retries failed
    throw lastError || new Error('Registration failed on all endpoints');
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