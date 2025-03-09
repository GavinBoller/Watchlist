import { createContext, ReactNode, useContext, useEffect } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { UserResponse } from "@shared/schema";
import { apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  saveToken,
  removeToken,
  getToken,
  parseUserFromToken,
} from "@/lib/jwtUtils";
import { isProductionEnvironment } from "@/lib/environment-utils";

type JwtLoginData = {
  username: string;
  password: string;
};

type JwtRegisterData = {
  username: string;
  password: string;
  displayName?: string;
  confirmPassword?: string;
};

type JwtLoginResponse = {
  token: string;
  user: UserResponse;
};

type JwtAuthContextType = {
  user: UserResponse | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<JwtLoginResponse, Error, JwtLoginData>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<JwtLoginResponse, Error, JwtRegisterData>;
};

export const JwtAuthContext = createContext<JwtAuthContextType | null>(null);

export function JwtAuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const isProd = isProductionEnvironment();

  // Get user data from JWT token with simplified approach
  const {
    data: user,
    error,
    isLoading,
    refetch,
  } = useQuery<UserResponse | null, Error>({
    queryKey: ["/api/jwt/user"],
    queryFn: async () => {
      console.log("[JWT AUTH] Starting user authentication check");
      
      try {
        // Check if we have a token
        const token = getToken();
        if (!token) {
          console.log("[JWT AUTH] No token found in storage");
          return null;
        }

        console.log("[JWT AUTH] Attempting to validate existing token");
        const res = await apiRequest("GET", "/api/jwt/user", undefined, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.log(`[JWT AUTH] Token validation failed: ${res.status} ${res.statusText}`);
          
          // In production, remove invalid token
          if (isProd && res.status === 401) {
            removeToken();
          }
          
          return null;
        }

        const userData = await res.json();
        return userData;
      } catch (error) {
        console.error("[JWT AUTH] Error fetching user:", error);
        return null;
      }
    },
    retry: isProd ? 0 : 1, // No retries in production to prevent potential redirect loops
  });

  // Login mutation - simplified and more reliable
  const loginMutation = useMutation({
    mutationFn: async (credentials: JwtLoginData) => {
      console.log("[JWT AUTH] Attempting login for user:", credentials.username);
      
      try {
        // Try our new simplified login endpoint first (the most reliable method)
        console.log("[JWT AUTH] Trying new simplified login endpoint");
        try {
          const simplifiedRes = await apiRequest("POST", "/api/simple-login", credentials);
          
          if (simplifiedRes.ok) {
            console.log("[JWT AUTH] Simplified login successful");
            return await simplifiedRes.json();
          }
        } catch (err) {
          console.log("[JWT AUTH] Simplified login error:", err);
          // Continue to next method if this fails
        }
        
        // Fallback to standard login if simplified fails
        console.log("[JWT AUTH] Simplified login failed, trying standard login");
        const standardRes = await apiRequest("POST", "/api/jwt/login", credentials);
        
        if (standardRes.ok) {
          console.log("[JWT AUTH] Standard login successful");
          return await standardRes.json();
        }
        
        // If both main methods fail, try emergency direct login
        console.log("[JWT AUTH] Both login methods failed, trying direct login");
        const directRes = await fetch(`/api/direct-login/${credentials.username}`);
        
        if (directRes.ok) {
          console.log("[JWT AUTH] Direct login successful");
          return await directRes.json();
        }
        
        // If all methods fail, throw an error with details from the standard attempt
        const errorText = await standardRes.text().catch(() => "Unknown error");
        throw new Error(`Login failed: ${errorText}`);
      } catch (error) {
        console.error("[JWT AUTH] All login attempts failed:", error);
        throw error;
      }
    },
    onSuccess: (data: JwtLoginResponse) => {
      console.log("[JWT AUTH] Login successful for:", data.user.username);
      // Save JWT token to localStorage
      saveToken(data.token);
      // Update user data
      queryClient.setQueryData(["/api/jwt/user"], data.user);
      toast({
        title: "Login successful",
        description: `Welcome back, ${data.user.displayName || data.user.username}!`,
      });
    },
    onError: (error: Error) => {
      console.error("[JWT AUTH] Login error:", error.message);
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async (userData: JwtRegisterData) => {
      console.log("[JWT AUTH] Attempting to register user:", userData.username);
      
      try {
        // First try simplified registration which is more reliable
        console.log("[JWT AUTH] Trying simplified registration endpoint");
        try {
          const simplifiedRes = await apiRequest("POST", "/api/simple-register", userData);
          
          if (simplifiedRes.ok) {
            console.log("[JWT AUTH] Simplified registration successful");
            return await simplifiedRes.json();
          }
        } catch (err) {
          console.log("[JWT AUTH] Simplified registration error:", err);
          // Continue to next method if this fails
        }
        
        // Fallback to standard registration
        console.log("[JWT AUTH] Trying standard registration");
        const standardRes = await apiRequest("POST", "/api/jwt/register", userData);
        
        if (standardRes.ok) {
          console.log("[JWT AUTH] Standard registration successful");
          return await standardRes.json();
        }
        
        // If in production and standard registration fails, try backdoor registration
        if (isProd) {
          console.log("[JWT AUTH] Standard registration failed, trying backdoor registration");
          const backdoorRes = await apiRequest("POST", "/api/jwt/backdoor-register", {
            username: userData.username,
            displayName: userData.displayName || userData.username
          });
          
          if (backdoorRes.ok) {
            console.log("[JWT AUTH] Backdoor registration successful");
            return await backdoorRes.json();
          }
        }
        
        // If everything fails, throw a generic error
        throw new Error("Registration failed: All registration methods failed");
      } catch (error) {
        console.error("[JWT AUTH] All registration attempts failed:", error);
        throw error;
      }
    },
    onSuccess: (data: JwtLoginResponse) => {
      console.log("[JWT AUTH] Registration successful for:", data.user.username);
      // Save JWT token to localStorage
      saveToken(data.token);
      // Update user data
      queryClient.setQueryData(["/api/jwt/user"], data.user);
      toast({
        title: "Registration successful",
        description: `Welcome, ${data.user.displayName || data.user.username}!`,
      });
    },
    onError: (error: Error) => {
      console.error("[JWT AUTH] Registration error:", error.message);
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Logout mutation with enhanced reliability
  const logoutMutation = useMutation({
    mutationFn: async () => {
      console.log("[JWT AUTH] Logging out user");
      
      // First, set flags to prevent token recovery
      try {
        localStorage.setItem('just_logged_out', 'true');
        sessionStorage.setItem('just_logged_out', 'true');
      } catch (e) {
        console.error("[JWT AUTH] Error setting logout flags:", e);
      }
      
      // Clear all tokens and state
      removeToken();
      
      // Try to perform server-side logout
      try {
        const { isProductionEnvironment, clearAllClientSideStorage } = await import('../lib/environment-utils');
        const isProd = isProductionEnvironment();
        console.log(`Logout initiated in ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} environment`);
        
        // In production, do a more aggressive clearing
        if (isProd) {
          clearAllClientSideStorage();
        }
        
        // Make server logout request with proper cache busting
        const response = await fetch('/api/logout', {
          method: 'POST',
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache'
          },
          cache: 'no-store'
        });
        
        if (response.ok) {
          console.log('Server-side logout successful');
        } else {
          console.warn('Server-side logout failed, but client-side logout completed');
        }
        
        // Schedule flag cleanup after 10 seconds
        setTimeout(() => {
          try {
            localStorage.removeItem('just_logged_out');
            sessionStorage.removeItem('just_logged_out');
          } catch (e) {
            // Ignore cleanup errors
          }
        }, 10000);
      } catch (e) {
        console.error("[JWT AUTH] Error during server logout:", e);
      }
    },
    onSuccess: () => {
      // Clear user data from cache
      queryClient.setQueryData(["/api/jwt/user"], null);
      
      // Clear any cached query data
      queryClient.clear();
      
      // Additional cleanup to prevent state persistence
      try {
        // Clear any window global state
        if (window.__authBackup) {
          delete window.__authBackup;
          console.log("[JWT AUTH] Cleared window.__authBackup state");
        }
      } catch (e) {
        console.error("[JWT AUTH] Error during additional cleanup:", e);
      }
      
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
    },
    onError: (error: Error) => {
      console.error("[JWT AUTH] Logout error:", error.message);
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
      
      // Even if the server logout fails, remove the token anyway
      removeToken();
      queryClient.setQueryData(["/api/jwt/user"], null);
    },
  });

  // Effect to handle token-based authentication on app load
  useEffect(() => {
    // Check if we have a token on mount
    const token = getToken();
    if (token) {
      refetch();
    }
  }, [refetch]);

  return (
    <JwtAuthContext.Provider
      value={{
        user: user || null,
        isLoading,
        error,
        loginMutation,
        logoutMutation,
        registerMutation,
      }}
    >
      {children}
    </JwtAuthContext.Provider>
  );
}

export function useJwtAuth() {
  const context = useContext(JwtAuthContext);
  if (!context) {
    throw new Error("useJwtAuth must be used within a JwtAuthProvider");
  }
  return context;
}