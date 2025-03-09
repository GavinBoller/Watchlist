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
    const response = await fetch('/api/simple-register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(userData)
    });
    
    // Handle successful response
    if (response.ok) {
      const responseJson = await response.json();
      
      // Save the token if provided
      if (responseJson.token) {
        saveToken(responseJson.token);
      }
      
      return { 
        user: responseJson.user, 
        token: responseJson.token 
      };
    }
    
    // Handle error response with more detailed logging
    const errorMessage = await safeParseResponse(response);
    console.error(`[SIMPLE AUTH] Registration failed with status ${response.status}: ${errorMessage}`);
    
    // Log more details to help diagnose the issue
    console.error(`[SIMPLE AUTH] Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
    console.error(`[SIMPLE AUTH] Response status: ${response.status} ${response.statusText}`);
    
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