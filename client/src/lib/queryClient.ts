import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { handleSessionExpiration, isSessionError } from './session-utils';
import { getToken, setAuthHeader } from './jwtUtils';

// Enhanced error handling with detailed error information and HTML response detection
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get('content-type');
    console.log(`Error response - Status: ${res.status}, Content-Type: ${contentType || 'none'}`);
    
    try {
      // Try to handle JSON responses
      if (contentType && contentType.includes('application/json')) {
        try {
          // Clone the response before attempting to read it as JSON
          const responseClone = res.clone();
          let jsonData;
          
          try {
            jsonData = await res.json();
            console.log("Error response JSON data:", jsonData);
          } catch (jsonParseError) {
            // If JSON parsing fails, try to get meaningful text instead
            console.error("Failed to parse JSON error response:", jsonParseError);
            const textData = await responseClone.text();
            console.log("Error response as text:", textData);
            
            // Create a more specific error for JSON parse failures
            const error = new Error(`${res.status}: Error parsing server response`);
            (error as any).status = res.status;
            (error as any).isJsonParseError = true;
            (error as any).isServerError = res.status >= 500;
            (error as any).isClientError = res.status >= 400 && res.status < 500;
            (error as any).responseText = textData;
            throw error;
          }
          
          // If we get here, JSON parsing succeeded
          const error = new Error(`${res.status}: ${jsonData.message || res.statusText}`);
          (error as any).status = res.status;
          (error as any).data = jsonData;
          (error as any).isServerError = res.status >= 500;
          (error as any).isClientError = res.status >= 400 && res.status < 500;
          throw error;
        } catch (handlingError) {
          // If this is our own error with status, just re-throw it
          if (handlingError instanceof Error && 
             ((handlingError as any).status || (handlingError as any).isJsonParseError)) {
            throw handlingError;
          }
          
          // Otherwise create a generic error
          console.error("Error handling error response:", handlingError);
          const error = new Error(`${res.status}: Unable to process server response`);
          (error as any).status = res.status;
          (error as any).isServerError = res.status >= 500;
          (error as any).isClientError = res.status >= 400 && res.status < 500;
          throw error;
        }
      } 
      // Check for HTML responses (like error pages) and handle them specially
      else if (contentType && contentType.includes('text/html')) {
        const htmlText = await res.text();
        console.log("Received HTML error response, length:", htmlText.length);
        
        // Extract a useful message if possible, or use a friendly error
        let errorMessage = "Received HTML response instead of data";
        if (htmlText.includes('<title>') && htmlText.includes('</title>')) {
          const titleMatch = htmlText.match(/<title>(.*?)<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            errorMessage = `Server returned HTML: ${titleMatch[1]}`;
          }
        }
        
        const error = new Error(errorMessage);
        (error as any).status = res.status;
        (error as any).isServerError = res.status >= 500;
        (error as any).isClientError = res.status >= 400 && res.status < 500;
        (error as any).isHtmlResponse = true;
        throw error;
      }
      // Handle all other non-JSON responses
      else {
        const text = (await res.text()) || res.statusText;
        console.log("Error response text (first 100 chars):", text.substring(0, 100));
        const error = new Error(`${res.status}: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`);
        (error as any).status = res.status;
        (error as any).isServerError = res.status >= 500;
        (error as any).isClientError = res.status >= 400 && res.status < 500;
        throw error;
      }
    } catch (parseError) {
      // If there's an error parsing the response,
      // throw a more generic error that still includes the status code
      if (parseError instanceof Error && (parseError as any).status) {
        throw parseError; // Re-throw if it's our own error
      }
      
      console.error("Error parsing response:", parseError);
      const error = new Error(`${res.status}: Response parsing failed`);
      (error as any).status = res.status;
      (error as any).originalError = parseError;
      (error as any).isServerError = res.status >= 500;
      (error as any).isClientError = res.status >= 400 && res.status < 500;
      throw error;
    }
  }
}

// Enhanced API request function with timeout, retry capabilities, and improved error handling
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options: {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
    ignoreAuthErrors?: boolean; // Flag to handle auth errors differently
    headers?: Record<string, string>; // Additional headers
  } = {}
): Promise<Response> {
  const { 
    timeout = 15000,       // 15 second default timeout
    retries = 2,           // 2 retries by default 
    retryDelay = 1000,     // 1 second delay between retries
    ignoreAuthErrors = false, // Default to throwing auth errors
    headers = {} // Custom headers to add
  } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      console.log(`[API] ${method} request to ${url} (attempt ${attempt + 1}/${retries + 1})`);
      if (data) {
        console.log(`[API] Request data:`, data);
      }
      
      try {
        // Merge default headers with custom headers
        const defaultHeaders = data ? { 
          "Content-Type": "application/json",
          // Add cache-busting headers for IE11 and some mobile browsers
          "Pragma": "no-cache",
          "Cache-Control": "no-cache, no-store, must-revalidate"
        } : {
          "Pragma": "no-cache", 
          "Cache-Control": "no-cache, no-store, must-revalidate"
        };
        
        // Add user recovery information - try to get current user from window object or storage
        try {
          // Try to get user info from window object (fastest)
          const authBackup = (window as any).__authBackup;
          if (authBackup && authBackup.userId) {
            console.log('[API] Adding user recovery info from in-memory backup');
            Object.assign(headers, {
              'X-User-ID': authBackup.userId.toString(),
              'X-Username': authBackup.username,
              'X-Request-Timestamp': Date.now().toString()
            });
          }
          // If not in window object, try session storage
          else {
            const backupJSON = sessionStorage.getItem('auth_backup');
            if (backupJSON) {
              const backup = JSON.parse(backupJSON);
              if (backup && backup.userId) {
                console.log('[API] Adding user recovery info from session storage');
                Object.assign(headers, {
                  'X-User-ID': backup.userId.toString(),
                  'X-Username': backup.username,
                  'X-Request-Timestamp': Date.now().toString()
                });
              }
            }
          }
        } catch (e) {
          console.error('[API] Error adding recovery headers:', e);
        }
        
        // Use the Headers API which correctly handles the types
        const headerObj = new Headers();
        
        // First add default headers
        if (data) {
          headerObj.set("Content-Type", "application/json");
        }
        headerObj.set("Pragma", "no-cache");
        headerObj.set("Cache-Control", "no-cache, no-store, must-revalidate");
        
        // Add JWT token for authentication
        const token = getToken();
        if (token) {
          headerObj.set("Authorization", `Bearer ${token}`);
          console.log('[API] Adding JWT token to request');
        }
        
        // Then add any custom headers
        Object.entries(headers).forEach(([key, value]) => {
          if (value !== undefined) {
            headerObj.set(key, String(value));
          }
        });
        
        // Execute the fetch request
        const res = await fetch(url, {
          method,
          headers: headerObj,
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include", // Always send cookies for authentication
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        console.log(`[API] Response status: ${res.status}, URL: ${url}`);
        
        // Special handling for auth errors if requested
        if (res.status === 401) {
          if (ignoreAuthErrors) {
            console.log(`[API] Ignoring 401 Unauthorized error as requested`);
            return res; // Return the response without throwing
          } else {
            // Handle unauthorized responses globally using our utility
            // This approach ensures a consistent user experience
            console.log(`[API] Detected 401 Unauthorized response, handling with session utilities`);
            
            // We'll let the error propagate but also trigger the session handler
            // This is non-blocking so the error will still be thrown below
            handleSessionExpiration('401', 'Your session has expired. Please log in again.');
            
            // Continue to the error handling code below which will throw correctly
          }
        }
        
        // For server errors (5xx), we might want to retry
        if (res.status >= 500 && attempt < retries) {
          lastError = new Error(`Server error: ${res.status}`);
          (lastError as any).status = res.status;
          // Wait before retrying with exponential backoff
          const delayTime = retryDelay * Math.pow(2, attempt);
          console.log(`[API] Server error (${res.status}), retrying in ${delayTime}ms...`);
          await new Promise(resolve => setTimeout(resolve, delayTime));
          continue;
        }
        
        // For other responses, process normally
        await throwIfResNotOk(res);
        return res;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      lastError = error as Error;
      console.error(`[API] Error during ${method} request to ${url}:`, error);
      
      // Special handling for auth errors if requested
      if ((error as any)?.status === 401 && ignoreAuthErrors) {
        console.log(`[API] Ignoring thrown 401 Unauthorized error as requested`);
        const mockResponse = new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
        return mockResponse;
      }
      
      // Handle session expiration globally for a consistent user experience
      // Only if this isn't a special endpoint that ignores auth errors
      // Use enhanced error detection to differentiate between auth and network errors
      const errorInfo = isSessionError(error);
      
      if (!ignoreAuthErrors && (
        (error as any)?.status === 401 || 
        errorInfo.isAuthError
      )) {
        console.log('[API] Detected potential auth error:', errorInfo);
        // Handle auth errors more gracefully - don't log out immediately
        // Wait at least 2 seconds before considering it a real session error
        setTimeout(async () => {
          console.log('[API] Delayed JWT check after 401 error');
          
          // Get JWT token from localStorage
          const token = getToken();
          
          if (!token) {
            // No token, definitely logged out
            handleSessionExpiration(
              (error as any)?.status || 'auth_error',
              "Please sign in to continue", // Simpler message
              1000 // shorter redirect delay since we already waited
            );
            return;
          }
          
          // Check JWT user endpoint directly with token in header
          const headers = new Headers();
          headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
          headers.set("Pragma", "no-cache");
          headers.set("Authorization", `Bearer ${token}`);
          
          const userData = await fetch('/api/jwt/user', {
            headers: headers
          }).then(res => {
            if (res.ok) return res.json();
            return null;
          }).catch(err => null);
          
          // If JWT is valid, don't show error
          if (userData) {
            console.log('[API] JWT appears valid after direct check - ignoring auth error');
            return;
          }
          
          // JWT is invalid, handle session expiration
          handleSessionExpiration(
            (error as any)?.status || 'auth_error',
            "Please sign in to continue", // Simpler message
            1000 // shorter redirect delay since we already waited
          );
        }, 2000);
      }
      
      // Don't retry client errors (4xx) or aborted requests
      if (
        (error instanceof Error && (error as any).isClientError) ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw error;
      }
      
      // For network errors or timeouts, retry if we have attempts left
      if (attempt < retries) {
        const delayTime = retryDelay * Math.pow(2, attempt);
        console.warn(`[API] Request attempt ${attempt + 1} failed, retrying in ${delayTime}ms`, error);
        await new Promise(resolve => setTimeout(resolve, delayTime));
        continue;
      }
      
      // We've exhausted all retries
      throw error;
    }
  }
  
  // This should never happen but TypeScript requires a return
  throw lastError || new Error('Request failed after all retries');
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  preventCaching?: boolean;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, preventCaching = true }) =>
  async ({ queryKey }) => {
    try {
      // Use the enhanced apiRequest function with improved error handling
      // and cache-busting for better reliability in production
      const baseUrl = queryKey[0] as string;
      
      // Add cache-busting query parameter for better reliability
      let url = baseUrl;
      if (preventCaching) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}_t=${Date.now()}`;
      }
      
      const res = await apiRequest('GET', url, undefined, { 
        ignoreAuthErrors: unauthorizedBehavior === "returnNull",
        retries: 2, // Retry up to 2 times (3 attempts total)
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        console.log(`[API] Returning null for unauthorized request to ${baseUrl}`);
        return null;
      }

      // apiRequest already validates the response
      return await res.json();
    } catch (error) {
      // Only log full errors in development - in production, be more concise
      if (process.env.NODE_ENV === 'development') {
        console.error(`Query fetch error for ${queryKey[0]}:`, error);
      } else {
        console.error(`Query fetch error for ${queryKey[0]}: ${(error as Error).message}`);
      }
      
      throw error;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true, // Enable refresh on window focus to improve session detection
      staleTime: 1000 * 60 * 5, // 5 minutes instead of Infinity for more frequent refreshes
      retry: (failureCount, error) => {
        // Don't retry 401/403 errors as they indicate auth issues
        if ((error as any)?.status === 401 || (error as any)?.status === 403) {
          console.log("[Query] Not retrying auth error:", (error as any)?.status);
          return false;
        }
        // Retry network and server errors up to 3 times, but not client errors
        if ((error as any)?.isClientError) return false;
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry 401/403 errors as they indicate auth issues
        if ((error as any)?.status === 401 || (error as any)?.status === 403) {
          console.log("[Mutation] Not retrying auth error:", (error as any)?.status);
          return false;
        }
        // Retry network and server errors up to 2 times, but not client errors
        if ((error as any)?.isClientError) return false;
        return failureCount < 2;
      },
      retryDelay: attemptIndex => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
    },
  },
});
