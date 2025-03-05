import { createContext, ReactNode, useContext } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// Extended User type with confirmPassword for registration
type RegisterData = Omit<InsertUser, 'confirmPassword'> & {
  confirmPassword: string;
};

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, RegisterData>;
};

type LoginData = Pick<InsertUser, "username" | "password">;

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  
  // Use a query to fetch the current user if there's an active session
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      try {
        // Enhanced session validation with three attempts and longer connection timeout
        const maxAttempts = 3;
        let lastError = null;
        
        for(let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            // Add delay between retries
            if(attempt > 0) {
              console.log(`Retry attempt ${attempt+1}/${maxAttempts} for auth check`);
              await new Promise(r => setTimeout(r, 1000 * attempt));
            }
            
            // Try both endpoint formats to handle redeployment and backward compatibility
            // First try the newer directly on /api endpoint with improved timeout handling
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
              
              const userRes = await fetch("/api/user", {
                credentials: "include",
                signal: controller.signal,
                headers: {
                  "Cache-Control": "no-cache, no-store, must-revalidate",
                  "Pragma": "no-cache" 
                }
              });
              
              clearTimeout(timeoutId);
              
              if (userRes.ok) {
                const userData = await userRes.json();
                console.log("Auth check successful via /api/user", userData);
                return userData;
              }
            } catch (directError) {
              console.log("Direct user endpoint error, trying session endpoint");
            }
            
            // If that fails, try the session endpoint with timeout handling
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
              
              const sessionRes = await fetch("/api/session", {
                credentials: "include",
                signal: controller.signal,
                headers: {
                  "Cache-Control": "no-cache, no-store, must-revalidate",
                  "Pragma": "no-cache" 
                }
              });
              
              clearTimeout(timeoutId);
              
              if (sessionRes.ok) {
                const data = await sessionRes.json();
                console.log("Auth check successful via /api/session", data);
                if (data.authenticated && data.user) {
                  return data.user;
                }
              }
            } catch (sessionError) {
              console.log("Session endpoint error, trying legacy user endpoint");
            }
            
            // Fall back to the user endpoint with timeout handling
            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
              
              const userRes = await fetch("/api/auth/user", {
                credentials: "include",
                signal: controller.signal,
                headers: {
                  "Cache-Control": "no-cache, no-store, must-revalidate",
                  "Pragma": "no-cache" 
                }
              });
              
              clearTimeout(timeoutId);
              
              if (userRes.ok) {
                const userData = await userRes.json();
                console.log("Auth check successful via /api/auth/user", userData);
                if (userData && userData.id) {
                  return userData;
                }
              }
            } catch (legacyError) {
              console.log("Legacy user endpoint error");
            }
            
            // If all endpoints failed but didn't throw (returned unsuccessful response codes)
            // We can consider the user not authenticated
            console.log("All auth endpoints returned unsuccessful responses - user not authenticated");
            return null;
          } catch (attemptError) {
            // Store the error and try again
            lastError = attemptError;
            console.error(`Auth check attempt ${attempt+1} failed:`, attemptError);
          }
        }
        
        // If we've tried all attempts and all failed with errors, return null
        console.error(`All ${maxAttempts} auth check attempts failed. Last error:`, lastError);
        return null;
      } catch (error) {
        console.error("Failed to fetch user session:", error);
        return null;
      }
    },
    staleTime: 1000 * 60 * 10, // 10 minutes instead of 5
    gcTime: 1000 * 60 * 15,    // 15 minutes instead of 10
    refetchOnWindowFocus: false, // Don't refetch on window focus as it can cause excess 401 errors
    retry: 2, // Additional retries at the React Query level
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      // Try the new endpoint first
      try {
        const res = await apiRequest("POST", "/api/login", credentials);
        
        // Check for success before trying to parse JSON
        if (res.ok) {
          try {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json();
              console.log("Login successful with /api/login endpoint", data);
              return data.user || data; // Handle both response formats
            } else {
              console.log("Response is not JSON, returning credentials username as fallback");
              // If we got a successful response but not JSON, create a minimal user object
              return { username: credentials.username, id: -1 };
            }
          } catch (jsonError) {
            console.error("JSON parsing error from /api/login:", jsonError);
            // If JSON parsing fails but login was successful, create a minimal user object
            return { username: credentials.username, id: -1 };
          }
        }
        
        // For error responses, don't try to parse JSON right away
        console.log("Login error with /api/login endpoint, status:", res.status);
        
        // Only try to parse JSON errors if the content type is correct
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await res.json();
            throw new Error(errorData.message || `Login failed with status ${res.status}`);
          } catch (jsonParseError) {
            throw new Error(`Login failed with status ${res.status}. Unable to parse error response.`);
          }
        } else {
          throw new Error(`Login failed with status ${res.status}. Response was not JSON.`);
        }
      } catch (directError) {
        console.log("Direct login endpoint error, trying legacy endpoint", directError);
        
        // Try the old endpoint as fallback
        try {
          const res = await apiRequest("POST", "/api/auth/login", credentials);
          
          // Check for success before trying to parse JSON
          if (res.ok) {
            try {
              const contentType = res.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const data = await res.json();
                console.log("Login successful with /api/auth/login endpoint", data);
                return data.user || data; // Handle both response formats
              } else {
                console.log("Response is not JSON, returning credentials username as fallback");
                // If we got a successful response but not JSON, create a minimal user object
                return { username: credentials.username, id: -1 };
              }
            } catch (jsonError) {
              console.error("JSON parsing error from /api/auth/login:", jsonError);
              // If JSON parsing fails but login was successful, create a minimal user object
              return { username: credentials.username, id: -1 };
            }
          }
          
          // For error responses, handle carefully
          console.log("Login error with /api/auth/login endpoint, status:", res.status);
          
          // Only try to parse JSON errors if the content type is correct
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await res.json();
              throw new Error(errorData.message || `Login failed with status ${res.status}`);
            } catch (jsonParseError) {
              throw new Error(`Login failed with status ${res.status}. Unable to parse error response.`);
            }
          } else {
            throw new Error(`Login failed with status ${res.status}. Response was not JSON.`);
          }
        } catch (legacyError) {
          console.error("Both login endpoints failed", legacyError);
          throw new Error("Login failed. Please try again later.");
        }
      }
    },
    onSuccess: (userData: SelectUser) => {
      console.log("Login successful, updating cache with user data:", userData);
      
      // Update all possible query paths to ensure consistency
      queryClient.setQueryData(["/api/user"], userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
      queryClient.setQueryData(["/api/session"], {
        authenticated: true,
        user: userData,
        sessionId: "active-session"
      });
      
      // Force reload the authentication status to ensure it's properly updated
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      
      toast({
        title: "Welcome back!",
        description: `You've successfully logged in as ${userData.username}`,
      });
      
      // Add a small delay to ensure session data is properly saved
      setTimeout(() => {
        // Double-check session after a short delay
        queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      }, 500);
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message || "There was a problem logging in",
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: RegisterData) => {
      // Try the new endpoint first
      try {
        const res = await apiRequest("POST", "/api/register", userData);
        
        // Check for success before trying to parse JSON
        if (res.ok) {
          try {
            const contentType = res.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const data = await res.json();
              console.log("Registration successful with /api/register endpoint", data);
              return data.user || data; // Handle both response formats
            } else {
              console.log("Response is not JSON, returning username as fallback");
              // If we got a successful response but not JSON, create a minimal user object
              return { username: userData.username, id: -1 };
            }
          } catch (jsonError) {
            console.error("JSON parsing error from /api/register:", jsonError);
            // If JSON parsing fails but registration was successful, create a minimal user object
            return { username: userData.username, id: -1 };
          }
        }
        
        // For error responses, don't try to parse JSON right away
        console.log("Registration error with /api/register endpoint, status:", res.status);
        
        // Only try to parse JSON errors if the content type is correct
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await res.json();
            throw new Error(errorData.message || `Registration failed with status ${res.status}`);
          } catch (jsonParseError) {
            throw new Error(`Registration failed with status ${res.status}. Unable to parse error response.`);
          }
        } else {
          throw new Error(`Registration failed with status ${res.status}. Response was not JSON.`);
        }
      } catch (directError) {
        console.log("Direct register endpoint error, trying legacy endpoint", directError);
        
        // Try the old endpoint as fallback
        try {
          const res = await apiRequest("POST", "/api/auth/register", userData);
          
          // Check for success before trying to parse JSON
          if (res.ok) {
            try {
              const contentType = res.headers.get('content-type');
              if (contentType && contentType.includes('application/json')) {
                const data = await res.json();
                console.log("Registration successful with /api/auth/register endpoint", data);
                return data.user || data; // Handle both response formats
              } else {
                console.log("Response is not JSON, returning username as fallback");
                // If we got a successful response but not JSON, create a minimal user object
                return { username: userData.username, id: -1 };
              }
            } catch (jsonError) {
              console.error("JSON parsing error from /api/auth/register:", jsonError);
              // If JSON parsing fails but registration was successful, create a minimal user object
              return { username: userData.username, id: -1 };
            }
          }
          
          // For error responses, handle carefully
          console.log("Registration error with /api/auth/register endpoint, status:", res.status);
          
          // Only try to parse JSON errors if the content type is correct
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            try {
              const errorData = await res.json();
              throw new Error(errorData.message || `Registration failed with status ${res.status}`);
            } catch (jsonParseError) {
              throw new Error(`Registration failed with status ${res.status}. Unable to parse error response.`);
            }
          } else {
            throw new Error(`Registration failed with status ${res.status}. Response was not JSON.`);
          }
        } catch (legacyError) {
          console.error("Both registration endpoints failed", legacyError);
          throw new Error("Registration failed. Please try again later.");
        }
      }
    },
    onSuccess: async (userData: SelectUser) => {
      console.log("Registration successful, updating cache with user data:", userData);
      
      // First round of updates to query cache
      queryClient.setQueryData(["/api/user"], userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
      queryClient.setQueryData(["/api/session"], {
        authenticated: true,
        user: userData,
        sessionId: "active-session"
      });
      
      // Function to validate the session (make sure user is really logged in)
      const validateSession = async (): Promise<boolean> => {
        try {
          console.log("Validating session after registration");
          const response = await fetch("/api/session", {
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
          
          if (response.ok) {
            const sessionData = await response.json();
            console.log("Session validation result:", sessionData);
            return sessionData.authenticated && sessionData.user !== null;
          }
          return false;
        } catch (error) {
          console.error("Session validation error:", error);
          return false;
        }
      };
      
      // Function to manually refresh the session
      const refreshSession = async (): Promise<boolean> => {
        try {
          console.log("Attempting to refresh session");
          const response = await fetch("/api/refresh-session", {
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
          
          if (response.ok) {
            const refreshData = await response.json();
            console.log("Session refresh result:", refreshData);
            return refreshData.success === true;
          }
          return false;
        } catch (error) {
          console.error("Session refresh error:", error);
          return false;
        }
      };
      
      // Show welcome toast
      toast({
        title: "Account created",
        description: `Welcome to MovieTracker, ${userData.username}!`,
      });
      
      // First, force a session validation
      const isSessionValid = await validateSession();
      
      // If session isn't valid, try refreshing it
      if (!isSessionValid) {
        console.log("Initial session validation failed, attempting refresh");
        await refreshSession();
        
        // Force reload authentication status
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/session"] });
        
        // Store user data in localStorage as emergency backup
        try {
          localStorage.setItem('emergency_user', JSON.stringify({
            user: userData,
            timestamp: Date.now()
          }));
          console.log("Stored emergency user data in localStorage");
        } catch (storageError) {
          console.error("Failed to store emergency user data:", storageError);
        }
      } else {
        console.log("Session validated successfully after registration");
      }
      
      // Final round of cache updates after validation attempts
      queryClient.setQueryData(["/api/user"], userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
      
      // Add a small delay to ensure session data is properly saved
      setTimeout(() => {
        console.log("Running delayed session checks");
        // Double-check session after a short delay
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      }, 1000);
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message || "There was a problem creating your account",
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Try the new endpoint first
      try {
        const res = await apiRequest("POST", "/api/logout");
        
        if (res.ok) {
          console.log("Logout successful with /api/logout endpoint");
          return;
        }
        
        console.log("Direct logout endpoint returned status:", res.status);
      } catch (directError) {
        console.log("Direct logout endpoint error, trying legacy endpoint", directError);
      }
      
      // Try the old endpoint as fallback
      try {
        const res = await apiRequest("POST", "/api/auth/logout");
        
        if (res.ok) {
          console.log("Logout successful with /api/auth/logout endpoint");
          return;
        }
        
        // If we get here, neither endpoint worked
        console.log("Legacy logout endpoint returned status:", res.status);
        
        // Special handling for production errors: if we get any non-5xx status,
        // consider the logout "successful" since we'll clear the local state anyway
        if (res.status < 500) {
          console.log("Non-server error status received, treating as successful logout");
          return;
        }
        
        throw new Error(`Logout failed with status ${res.status}`);
      } catch (legacyError) {
        console.error("Both logout endpoints failed", legacyError);
        
        // Even if server-side logout fails, we can still clear client state
        // This provides a better UX in case of server issues
        console.log("Treating as successful logout despite server errors");
        return;
      }
    },
    onSuccess: () => {
      console.log("Logout successful, clearing user data from cache");
      
      // Clear all query caches
      queryClient.setQueryData(["/api/user"], null);
      queryClient.setQueryData(["/api/auth/user"], null);
      queryClient.setQueryData(["/api/session"], {
        authenticated: false,
        user: null,
        sessionId: null
      });
      
      // Invalidate all authentication-related queries
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/session"] }); 
      // Invalidate watchlist queries to clear user-specific data
      queryClient.invalidateQueries({ queryKey: ["/api/watchlist"] });
      
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message || "There was a problem logging out",
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Export a hook that simplifies access to the auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}