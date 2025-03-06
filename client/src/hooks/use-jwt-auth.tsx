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

  // Get user data from JWT token
  const {
    data: user,
    error,
    isLoading,
    refetch,
  } = useQuery<UserResponse | null, Error>({
    queryKey: ["/api/jwt/user"],
    queryFn: async () => {
      // First try to get user from API
      try {
        // Check if we have a token
        const token = getToken();
        if (!token) return null;

        const res = await apiRequest("GET", "/api/jwt/user", undefined, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          // If API fails with 401, try to parse user from token as fallback
          if (res.status === 401) {
            const userFromToken = parseUserFromToken();
            if (userFromToken) {
              console.log("[JWT] Using parsed user from token:", userFromToken);
              return userFromToken;
            }
          }
          throw new Error(`Authentication failed: ${res.statusText}`);
        }

        return await res.json();
      } catch (error) {
        console.error("[JWT AUTH] Error fetching user:", error);
        // As final fallback, try to parse user from token
        const userFromToken = parseUserFromToken();
        if (userFromToken) {
          console.log("[JWT] Using parsed user from token as fallback");
          return userFromToken;
        }
        return null;
      }
    },
    retry: 1,
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