import { createContext, useContext } from "react";
import { JwtAuthContext } from "@/hooks/use-jwt-auth";

// Create a separate context to prevent export conflicts
export const UserContext = createContext<any>(null);

// Legacy context hook for backward compatibility
export const useUserContext = () => {
  // First try to get the UserContext directly
  const userContext = useContext(UserContext);
  if (userContext) {
    return userContext;
  }

  // Fallback to JWT Auth context if UserContext is not available
  const jwtAuth = useContext(JwtAuthContext);
  if (!jwtAuth) {
    throw new Error("useUserContext must be used within a provider (UserContext or JwtAuthProvider)");
  }
  
  // Build a compatible interface from JWT Auth
  return {
    currentUser: jwtAuth.user,
    setCurrentUser: () => {}, // Deprecated
    login: () => {}, // Deprecated
    logout: () => jwtAuth.logoutMutation.mutateAsync(),
    isAuthenticated: !!jwtAuth.user,
    // Basic user management functions
    addUser: async () => false, // Not supported in JWT auth
    getUsers: async () => [], // Not supported in JWT auth
  };
};