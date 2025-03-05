import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { handleSessionExpiration, isSessionError } from './session-utils';

// Enhanced error handling with detailed error information and HTML response detection
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get('content-type');
    console.log(`Error response - Status: ${res.status}, Content-Type: ${contentType || 'none'}`);
    
    try {
      // Try to handle JSON responses
      if (contentType && contentType.includes('application/json')) {
        try {
          const jsonData = await res.json();
          console.log("Error response JSON data:", jsonData);
          const error = new Error(`${res.status}: ${jsonData.message || res.statusText}`);
          (error as any).status = res.status;
          (error as any).data = jsonData;
          (error as any).isServerError = res.status >= 500;
          (error as any).isClientError = res.status >= 400 && res.status < 500;
          throw error;
        } catch (jsonError) {
          console.error("Failed to parse JSON error response:", jsonError);
          const error = new Error(`${res.status}: Invalid JSON response`);
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
  } = {}
): Promise<Response> {
  const { 
    timeout = 15000,       // 15 second default timeout
    retries = 2,           // 2 retries by default 
    retryDelay = 1000,     // 1 second delay between retries
    ignoreAuthErrors = false // Default to throwing auth errors
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
        const res = await fetch(url, {
          method,
          headers: data ? { 
            "Content-Type": "application/json",
            // Add cache-busting headers for IE11 and some mobile browsers
            "Pragma": "no-cache",
            "Cache-Control": "no-cache, no-store, must-revalidate"
          } : {
            "Pragma": "no-cache", 
            "Cache-Control": "no-cache, no-store, must-revalidate"
          },
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
      if (!ignoreAuthErrors && (
        (error as any)?.status === 401 || 
        isSessionError(error)
      )) {
        console.log('[API] Detected session expiration, handling...');
        // Don't await this so we don't block the promise rejection chain
        // This will handle the UI feedback separately
        handleSessionExpiration(
          (error as any)?.status || 'auth_error',
          (error as any)?.data?.message || (error as Error).message
        );
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
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        // Retry network and server errors up to 3 times, but not client errors
        if ((error as any)?.isClientError) return false;
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * Math.pow(2, attemptIndex), 30000),
    },
    mutations: {
      retry: (failureCount, error) => {
        // Retry network and server errors up to 2 times, but not client errors
        if ((error as any)?.isClientError) return false;
        return failureCount < 2;
      },
      retryDelay: attemptIndex => Math.min(1000 * Math.pow(2, attemptIndex), 10000),
    },
  },
});
