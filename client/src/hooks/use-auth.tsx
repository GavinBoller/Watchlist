import { createContext, ReactNode, useContext } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { insertUserSchema, User as SelectUser, InsertUser } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { detectAutoLogoutPattern } from "@/lib/session-utils";

// Extended User type with confirmPassword for registration
type RegisterData = Omit<InsertUser, 'confirmPassword'> & {
  confirmPassword: string;
};

// Define the type for our logout mutation result
type LogoutResult = { 
  autoLogoutPrevented?: boolean;
  success?: boolean;
  clientSideOnly?: boolean;
};

type AuthContextType = {
  user: SelectUser | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  logoutMutation: UseMutationResult<LogoutResult, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, RegisterData>;
};

type LoginData = Pick<InsertUser, "username" | "password">;

// Create context with default value
export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  
  // Use a query to fetch the current user if there's an active session
  const {
    data: user,
    error,
    isLoading,
    refetch: refetchUser
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: async () => {
      try {
        // First try the standard user endpoint
        const primaryRes = await apiRequest("GET", "/api/user", null, {timeout: 5000});
        if (primaryRes.ok) {
          const userData = await primaryRes.json();
          console.log("User authenticated via primary endpoint:", userData?.username || 'unknown');
          return userData;
        }
        
        // If primary fails, try session endpoint as fallback
        console.log("Primary authentication check failed, trying session endpoint...");
        const sessionRes = await apiRequest("GET", "/api/session", null, {timeout: 5000});
        if (sessionRes.ok) {
          const sessionData = await sessionRes.json();
          if (sessionData?.authenticated && sessionData?.user) {
            console.log("User authenticated via session endpoint:", sessionData.user?.username || 'unknown');
            return sessionData.user;
          }
        }
        
        // If both checks fail, the user is not authenticated
        console.log("Auth check failed on all endpoints - user not authenticated");
        return null;
      } catch (error) {
        console.error("Failed to fetch user session:", error);
        return null;
      }
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
    gcTime: 1000 * 60 * 15,    // 15 minutes
    refetchOnWindowFocus: false, // Don't refetch on window focus
    retry: 2 // Additional retries at the React Query level
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      try {
        console.log("[AUTH] Attempting login with credentials:", credentials.username);
        
        // STEP 1: Try standard login endpoint first
        try {
          console.log("[AUTH] Trying standard login endpoint...");
          const res = await apiRequest("POST", "/api/login", credentials, {timeout: 5000});
          
          // Check Content-Type header to ensure we're getting JSON
          const contentType = res.headers.get('content-type');
          console.log("[AUTH] Login response Content-Type:", contentType);
          
          // If login succeeds, parse the response
          if (res.ok && contentType && contentType.includes('application/json')) {
            try {
              const userData = await res.json();
              console.log("[AUTH] Login successful via standard endpoint:", userData.username);
              return userData;
            } catch (jsonError) {
              console.error("[AUTH] Failed to parse successful login response:", jsonError);
              // Continue to emergency login if parsing fails
            }
          } else {
            console.log("[AUTH] Standard login failed with status:", res.status);
            // Continue to emergency login
          }
        } catch (standardLoginError) {
          console.error("[AUTH] Error with standard login:", standardLoginError);
          // Continue to emergency login
        }
        
        // STEP 2: If standard login fails for any reason, try emergency login
        console.log("[AUTH] Trying emergency login endpoint...");
        try {
          // Try the auth/emergency-login endpoint first
          const emergencyRes = await apiRequest("POST", "/api/auth/emergency-login", credentials, {timeout: 5000});
          
          if (emergencyRes.ok) {
            const userData = await emergencyRes.json();
            console.log("[AUTH] Emergency login successful:", userData.username);
            toast({
              title: "Login successful",
              description: "Connected using emergency pathway",
              variant: "default"
            });
            return userData;
          } else {
            console.log("[AUTH] First emergency login path failed with status:", emergencyRes.status);
            
            // Try the second emergency endpoint as a last resort
            console.log("[AUTH] Trying secondary emergency login endpoint...");
            const secondaryRes = await apiRequest("POST", "/api/emergency/watchlist/login", credentials, {timeout: 5000});
            
            if (secondaryRes.ok) {
              const userData = await secondaryRes.json();
              console.log("[AUTH] Secondary emergency login successful:", userData.username);
              toast({
                title: "Login successful",
                description: "Connected using backup pathway",
                variant: "default"
              });
              return userData;
            }
            
            // If both emergency logins fail, throw an error
            throw new Error(`All login attempts failed (${emergencyRes.status})`);
          }
        } catch (emergencyError) {
          console.error("[AUTH] Error with emergency login:", emergencyError);
          throw emergencyError;
        }
      } catch (error) {
        console.error("[AUTH] Final login error:", error);
        throw error;
      }
    },
    onSuccess: (userData: SelectUser) => {
      console.log("Login successful, user data:", userData);
      queryClient.setQueryData(["/api/user"], userData);
      
      // Safety check for username
      const displayName = userData?.username || userData?.displayName || "user";
      
      toast({
        title: "Welcome back!",
        description: `You've successfully logged in as ${displayName}`,
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
      try {
        const res = await apiRequest("POST", "/api/register", userData);
        if (!res.ok) {
          throw new Error(`Registration failed with status ${res.status}`);
        }
        const data = await res.json();
        console.log("Registration response data:", data);
        
        // Extract the user object based on response structure
        const user = data.user || data;
        return user;
      } catch (error) {
        console.error("Registration error:", error);
        throw error;
      }
    },
    onSuccess: (userData: SelectUser) => {
      console.log("Registration successful, user data:", userData);
      queryClient.setQueryData(["/api/user"], userData);
      
      // Safety check for username
      const displayName = userData?.username || userData?.displayName || "user";
      
      toast({
        title: "Account created",
        description: `Welcome to MovieTracker, ${displayName}!`,
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
      try {
        // OPTIMIZATION: Pre-set the redirect for faster logout
        // Create a hidden form to use for navigation instead of location.replace
        // This trick forces an immediate page reload without waiting for the response
        const form = document.createElement('form');
        form.method = 'GET';
        form.action = '/auth';
        form.style.display = 'none';
        document.body.appendChild(form);
        
        // Mark this as an intentional logout to prevent auto-logout detection
        localStorage.setItem('movietracker_intentional_logout_time', Date.now().toString());
        
        // Clear local storage of all session data immediately (don't wait)
        localStorage.removeItem('movietracker_user');
        localStorage.removeItem('movietracker_session_id');
        localStorage.removeItem('movietracker_enhanced_backup');
        localStorage.removeItem('movietracker_username');
        localStorage.removeItem('movietracker_last_verified');
        localStorage.removeItem('movietracker_session_heartbeat');
        console.log("Cleared all session data before logout request");
        
        // Start the server-side logout
        const logoutPromise = apiRequest("POST", "/api/logout");
        
        // Don't wait for the logout response - submit the form immediately
        // This will cause a full page reload to /auth without waiting for API response
        form.submit();
        
        // Continue with the API call in the background
        // Even though we're already redirecting, we need to complete the server logout
        const res = await logoutPromise;
        if (!res.ok) {
          throw new Error(`Logout failed with status ${res.status}`);
        }
        
        return { success: true, clientSideRedirect: true };
      } catch (error) {
        console.error("Logout error:", error);
        throw error;
      }
    },
    onSuccess: () => {
      // Clear all auth-related cache (may not run due to redirect)
      queryClient.setQueryData(["/api/user"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      
      // Fallback redirect if the form submit didn't work for some reason
      try {
        window.location.href = '/auth'; 
      } catch (e) {
        console.error("Fallback redirect failed:", e);
      }
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

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
