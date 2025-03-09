import { UserResponse } from '@shared/schema';
import { saveToken } from './jwtUtils';

// Helper function to safely parse response text
async function safeParseResponse(response: Response): Promise<string> {
  try {
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        const jsonData = await response.json();
        
        // Format JSON error nicely
        if (jsonData.error) return jsonData.error;
        if (jsonData.message) return jsonData.message;
        return JSON.stringify(jsonData);
      } catch (e) {
        console.error('[AUTH] Failed to parse JSON response:', e);
      }
    }
    
    // Default to text if JSON fails or content-type is not JSON
    const text = await response.text();
    return text.slice(0, 100) + (text.length > 100 ? '...' : ''); // Truncate long responses
  } catch (e) {
    console.error('[AUTH] Failed to read response:', e);
    return 'Error reading server response';
  }
}

/**
 * Simple registration function that uses our streamlined JWT registration endpoint
 */
export async function simpleRegister(userData: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<{ user: UserResponse, token: string }> {  
  try {
    // Make the API request to our simple-register endpoint
    console.log('[SIMPLE AUTH] Starting registration with simple-register endpoint');
    console.log('[SIMPLE AUTH] Registration payload:', JSON.stringify({
      ...userData, 
      password: userData.password ? '******' : undefined // Hide actual password in logs
    }));
    
    let fetchResponse: Response;
    let error: Error | null = null;
    
    // First try the normal endpoint
    try {
      console.log('[SIMPLE AUTH] Trying primary registration endpoint: /api/simple-register');
      fetchResponse = await fetch('/api/simple-register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });
      
      // If successful, continue with this response
      console.log(`[SIMPLE AUTH] Primary registration endpoint responded with status: ${fetchResponse.status}`);
      
      // If we got an error status, save the error but try the alternative
      if (!fetchResponse.ok) {
        const errorText = await fetchResponse.text();
        error = new Error(`Primary endpoint error: ${fetchResponse.status} - ${errorText}`);
        
        // Don't throw yet - we'll try the fallback endpoint
        console.log('[SIMPLE AUTH] Primary endpoint failed, will try alternative');
        
        // Try the alternative direct endpoint
        console.log('[SIMPLE AUTH] Trying alternative registration endpoint: /api/simple-register-direct');
        fetchResponse = await fetch('/api/simple-register-direct', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(userData)
        });
        
        console.log(`[SIMPLE AUTH] Alternative registration endpoint responded with status: ${fetchResponse.status}`);
      }
    } catch (fetchError) {
      // Enhanced fetch error logging for network issues
      console.error('[SIMPLE AUTH] Fetch failed on primary endpoint:', fetchError);
      
      // Try the alternative direct endpoint
      try {
        console.log('[SIMPLE AUTH] Trying alternative registration endpoint after network error');
        fetchResponse = await fetch('/api/simple-register-direct', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(userData)
        });
        
        console.log(`[SIMPLE AUTH] Alternative registration responded with status: ${fetchResponse.status}`);
      } catch (backupError) {
        console.error('[SIMPLE AUTH] Both registration endpoints failed:', backupError);
        throw new Error(`Network error during registration: ${String(fetchError)}`);
      }
    }
    
    // Handle successful response
    if (fetchResponse.ok) {
      const responseJson = await fetchResponse.json();
      
      // Save the token if provided
      if (responseJson.token) {
        saveToken(responseJson.token);
      }
      
      console.log('[SIMPLE AUTH] Registration successful, token saved');
      
      return { 
        user: responseJson.user, 
        token: responseJson.token 
      };
    }
    
    // Handle error response with more detailed logging
    const errorMessage = await safeParseResponse(fetchResponse);
    console.error(`[SIMPLE AUTH] Registration failed with status ${fetchResponse.status}: ${errorMessage}`);
    
    // Log more details to help diagnose the issue
    console.error(`[SIMPLE AUTH] Response headers: ${JSON.stringify(Object.fromEntries(fetchResponse.headers.entries()))}`);
    console.error(`[SIMPLE AUTH] Response status: ${fetchResponse.status} ${fetchResponse.statusText}`);
    
    throw new Error(`Registration failed: ${errorMessage}`);
  } catch (error) {
    console.error('[AUTH] Registration failed:', error);
    
    // Enhanced network error detection
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      throw new Error('Network error - please check your internet connection and try again.');
    }
    
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