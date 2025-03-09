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

        return await res.json();
      } catch (error) {
        console.error("[JWT AUTH] Error fetching user:", error);
        return null;
      }
    },
    retry: isProd ? 0 : 1, // No retries in production to prevent potential redirect loops
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (credentials: JwtLoginData) => {
      console.log("[JWT AUTH] Attempting login for user:", credentials.username);
      
      const res = await apiRequest("POST", "/api/jwt/login", credentials);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        throw new Error(`Login failed: ${errorText}`);
      }
      return await res.json();
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
      
      // In production, use the simplified registration endpoint for better reliability
      const endpoint = isProd ? "/api/simple-register" : "/api/jwt/register";
      
      const res = await apiRequest("POST", endpoint, userData);
      if (!res.ok) {
        const errorText = await res.text().catch(() => "Unknown error");
        throw new Error(`Registration failed: ${errorText}`);
      }
      return await res.json();
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

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      console.log("[JWT AUTH] Logging out user");
      // Since JWT is stateless, we just need to remove the token
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