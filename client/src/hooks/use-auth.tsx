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
        // Try both endpoint formats to handle redeployment and backward compatibility
        // First try the newer directly on /api endpoint
        try {
          const userRes = await fetch("/api/user", {
            credentials: "include",
          });
          
          if (userRes.ok) {
            return await userRes.json();
          }
        } catch (directError) {
          console.log("Direct user endpoint error, trying session endpoint");
        }
        
        // If that fails, try the session endpoint
        const sessionRes = await fetch("/api/session", {
          credentials: "include",
        });
        
        if (sessionRes.ok) {
          const data = await sessionRes.json();
          if (data.authenticated && data.user) {
            return data.user;
          }
          return null;
        }
        
        // Fall back to the user endpoint
        const userRes = await fetch("/api/auth/user", {
          credentials: "include",
        });
        
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData && userData.id) {
            return userData;
          }
        }
        
        return null;
      } catch (error) {
        console.error("Failed to fetch user session:", error);
        return null;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10,   // 10 minutes
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
      // Update both cache keys to ensure both endpoint formats work
      queryClient.setQueryData(["/api/user"], userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
      toast({
        title: "Welcome back!",
        description: `You've successfully logged in as ${userData.username}`,
      });
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
    onSuccess: (userData: SelectUser) => {
      // Update both cache keys to ensure both endpoint formats work
      queryClient.setQueryData(["/api/user"], userData);
      queryClient.setQueryData(["/api/auth/user"], userData);
      toast({
        title: "Account created",
        description: `Welcome to MovieTracker, ${userData.username}!`,
      });
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
      // Clear cache for both endpoint formats
      queryClient.setQueryData(["/api/user"], null);
      queryClient.setQueryData(["/api/auth/user"], null);
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