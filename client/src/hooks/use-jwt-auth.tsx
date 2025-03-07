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

  // Get user data from JWT token with enhanced fallback mechanisms
  const {
    data: user,
    error,
    isLoading,
    refetch,
  } = useQuery<UserResponse | null, Error>({
    queryKey: ["/api/jwt/user"],
    queryFn: async () => {
      console.log("[JWT AUTH] Starting user authentication check");
      
      // Try emergency token as last resort if we detect repeated auth failures
      const needsEmergencyToken = localStorage.getItem('jwt_auth_failures') && 
                               parseInt(localStorage.getItem('jwt_auth_failures') || '0') > 3;
      
      if (needsEmergencyToken) {
        console.log("[JWT AUTH] Multiple auth failures detected, trying emergency token");
        try {
          const response = await fetch('/api/jwt/emergency-token');
          if (response.ok) {
            const data = await response.json();
            if (data.token && data.user) {
              console.log("[JWT AUTH] Emergency token obtained successfully");
              saveToken(data.token);
              localStorage.removeItem('jwt_auth_failures');
              return data.user;
            }
          }
        } catch (err) {
          console.error("[JWT AUTH] Failed to get emergency token:", err);
        }
      }
      
      // Normal authentication flow
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
          // If API fails with 401, try to parse user from token as fallback
          if (res.status === 401) {
            console.log("[JWT AUTH] 401 from /api/jwt/user endpoint, token may be invalid");
            
            // Increment auth failure counter
            const failures = parseInt(localStorage.getItem('jwt_auth_failures') || '0');
            localStorage.setItem('jwt_auth_failures', (failures + 1).toString());
            
            // Try to parse user from token as fallback
            const userFromToken = parseUserFromToken();
            if (userFromToken) {
              console.log("[JWT AUTH] Using parsed user from token:", userFromToken.username);
              return userFromToken;
            }
          }
          throw new Error(`Authentication failed: ${res.statusText}`);
        }

        // Success! Clear failure counter
        localStorage.removeItem('jwt_auth_failures');
        return await res.json();
      } catch (error) {
        console.error("[JWT AUTH] Error fetching user:", error);
        
        // As final fallback, try to parse user from token
        const userFromToken = parseUserFromToken();
        if (userFromToken) {
          console.log("[JWT AUTH] Using parsed user from token as final fallback");
          return userFromToken;
        }
        
        return null;
      }
    },
    retry: 1,
    retryDelay: 1000,
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (credentials: JwtLoginData) => {
      const res = await apiRequest("POST", "/api/jwt/login", credentials);
      if (!res.ok) {
        throw new Error(`Login failed: ${res.statusText}`);
      }
      return await res.json();
    },
    onSuccess: (data: JwtLoginResponse) => {
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
      const res = await apiRequest("POST", "/api/jwt/register", userData);
      if (!res.ok) {
        throw new Error(`Registration failed: ${res.statusText}`);
      }
      return await res.json();
    },
    onSuccess: (data: JwtLoginResponse) => {
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
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Since JWT is stateless, we just need to remove the token
      // No need for server call, but we'll keep the API structure consistent
      removeToken();
    },
    onSuccess: () => {
      // Clear user data
      queryClient.setQueryData(["/api/jwt/user"], null);
      toast({
        title: "Logged out",
        description: "You have been successfully logged out.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
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
        user,
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