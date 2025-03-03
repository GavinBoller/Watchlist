import { QueryClient, QueryFunction } from "@tanstack/react-query";

// Enhanced error handling with detailed error information
async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const contentType = res.headers.get('content-type');
    try {
      if (contentType && contentType.includes('application/json')) {
        const jsonData = await res.json();
        const error = new Error(`${res.status}: ${jsonData.message || res.statusText}`);
        (error as any).status = res.status;
        (error as any).data = jsonData;
        (error as any).isServerError = res.status >= 500;
        (error as any).isClientError = res.status >= 400 && res.status < 500;
        throw error;
      } else {
        const text = (await res.text()) || res.statusText;
        const error = new Error(`${res.status}: ${text}`);
        (error as any).status = res.status;
        (error as any).isServerError = res.status >= 500;
        (error as any).isClientError = res.status >= 400 && res.status < 500;
        throw error;
      }
    } catch (parseError) {
      // If there's an error parsing the response (e.g., invalid JSON),
      // throw a more generic error that still includes the status code
      if (parseError instanceof Error && (parseError as any).status) {
        throw parseError; // Re-throw if it's our own error
      }
      const error = new Error(`${res.status}: Response parsing failed`);
      (error as any).status = res.status;
      (error as any).originalError = parseError;
      (error as any).isServerError = res.status >= 500;
      (error as any).isClientError = res.status >= 400 && res.status < 500;
      throw error;
    }
  }
}

// Enhanced API request function with timeout and retry capabilities
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options: {
    timeout?: number;
    retries?: number;
    retryDelay?: number;
  } = {}
): Promise<Response> {
  const { 
    timeout = 15000, // 15 second default timeout
    retries = 2,     // 2 retries by default 
    retryDelay = 1000 // 1 second delay between retries
  } = options;
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      try {
        const res = await fetch(url, {
          method,
          headers: data ? { "Content-Type": "application/json" } : {},
          body: data ? JSON.stringify(data) : undefined,
          credentials: "include",
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // For server errors (5xx), we might want to retry
        if (res.status >= 500 && attempt < retries) {
          lastError = new Error(`Server error: ${res.status}`);
          (lastError as any).status = res.status;
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
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
      
      // Don't retry client errors (4xx) or aborted requests
      if (
        (error instanceof Error && (error as any).isClientError) ||
        (error instanceof DOMException && error.name === 'AbortError' && attempt >= retries)
      ) {
        throw error;
      }
      
      // For network errors or timeouts, retry if we have attempts left
      if (attempt < retries) {
        console.warn(`API request attempt ${attempt + 1} failed, retrying in ${retryDelay * Math.pow(2, attempt)}ms`, error);
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt)));
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
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    try {
      const res = await fetch(queryKey[0] as string, {
        credentials: "include",
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);
      return await res.json();
    } catch (error) {
      console.error(`Query fetch error for ${queryKey[0]}:`, error);
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
