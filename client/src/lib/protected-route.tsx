import { useJwtAuth } from "@/hooks/use-jwt-auth";
import { Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Redirect, Route, useLocation } from "wouter";
import { getToken, parseUserFromToken } from "./jwtUtils";
import { queryClient } from "./queryClient";

// Define the window property for temporary registration data
declare global {
  interface Window {
    __tempRegistrationData?: {
      timestamp: number;
      username: string;
    };
  }
}

export function ProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, isLoading } = useJwtAuth();
  const [isVerifyingToken, setIsVerifyingToken] = useState(false);
  const [verifiedStatus, setVerifiedStatus] = useState<boolean | null>(null);
  const [, navigate] = useLocation();

  // JWT verification that checks if we have a valid token even if the user context isn't loaded yet
  const verifyJwtToken = useCallback(async () => {
    console.log("Protected route: JWT token verification starting");
    setIsVerifyingToken(true);
    try {
      // Check if we have a token
      const token = getToken();
      if (!token) {
        console.log("No JWT token found, not authenticated");
        setVerifiedStatus(false);
        return;
      }
      
      // Try to parse user from token as a first check
      const userFromToken = parseUserFromToken();
      if (userFromToken) {
        console.log("JWT token contains valid user data");
        
        // Update query cache with user data from token
        queryClient.setQueryData(["/api/jwt/user"], userFromToken);
        
        // Set as authenticated
        setVerifiedStatus(true);
      } else {
        // Token exists but couldn't be parsed, might be invalid
        console.log("JWT token exists but couldn't be parsed, might be invalid");
        setVerifiedStatus(false);
      }
    } catch (error) {
      console.error("Protected route: JWT verification error", error);
      // Assume not authenticated on error
      setVerifiedStatus(false);
    } finally {
      setIsVerifyingToken(false);
    }
  }, []);

  // Secondary verification for edge cases where useAuth might report incorrect state
  // Check if this is an intentional logout in progress to avoid verification
  const isIntentionalLogout = useCallback(() => {
    try {
      const logoutTime = localStorage.getItem('movietracker_intentional_logout_time');
      if (!logoutTime) return false;
      
      const parsedTime = parseInt(logoutTime, 10);
      const now = Date.now();
      // If logout was less than 3 seconds ago, consider this an intentional logout
      return !isNaN(parsedTime) && (now - parsedTime < 3000);
    } catch (e) {
      return false;
    }
  }, []);

  useEffect(() => {
    // Skip verification if we're in an intentional logout flow
    if (isIntentionalLogout()) {
      console.log("ProtectedRoute: Skipping verification during logout flow");
      return;
    }
    
    // Only verify if not already loading, not already verifying, and user is null (potentially false negative)
    if (!isLoading && !isVerifyingToken && !user && verifiedStatus === null) {
      console.log("ProtectedRoute: Starting JWT verification because user is null but authentication status is unknown");
      verifyJwtToken();
    } else if (!isLoading && !isVerifyingToken) {
      if (user) {
        console.log("ProtectedRoute: Using cached user authentication:", user.username);
        
        // Store a backup of the user data in localStorage for emergency recovery
        try {
          localStorage.setItem('movietracker_user', JSON.stringify(user));
          localStorage.setItem('movietracker_username', user.username);
            
          // Create a heartbeat to monitor auth health
          const now = Date.now();
          const heartbeat = {
            timestamp: now,
            username: user.username,
            userId: user.id,
            lastActive: now,
            route: path
          };
          localStorage.setItem('movietracker_auth_heartbeat', JSON.stringify(heartbeat));
        } catch (e) {
          console.error('Failed to create backup for user:', e);
        }
      } else if (verifiedStatus !== null) {
        console.log("ProtectedRoute: Using verified JWT status:", verifiedStatus);
      }
    }
  }, [isLoading, isVerifyingToken, user, verifiedStatus, verifyJwtToken, path]);

  // Check for environment - production needs special handling
  const isProduction = window.location.hostname.includes('.replit.app') || 
                       !window.location.hostname.includes('localhost');
                       
  // Check for cached registration data to prevent login page flash during registration
  // In production, we use a longer timeout period to account for network delays
  const registrationTimeTolerance = isProduction ? 10000 : 5000;
  const recentlyRegistered = window.__tempRegistrationData && 
                             (Date.now() - window.__tempRegistrationData.timestamp < registrationTimeTolerance);
                             
  // Check for LocalStorage fallback user data from recent registration
  const hasLocalStorageUser = (() => {
    try {
      const storedUser = localStorage.getItem('movietracker_user');
      return !!storedUser;
    } catch (e) {
      return false;
    }
  })();
  
  // In production, if we have a recent registration (within last 10 seconds) and also
  // have localStorage data, we can be more confident this is a valid registration
  const isConfidentRecentRegistration = isProduction && 
                                       recentlyRegistered && 
                                       hasLocalStorageUser;
                             
  // If we're loading OR verifying token, show loading indicator
  if (isLoading || isVerifyingToken) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
          <span className="ml-2 text-muted-foreground">
            {recentlyRegistered ? "Completing your registration..." : "Verifying your authentication..."}
          </span>
        </div>
      </Route>
    );
  }

  // If user exists OR verified token says they're authenticated OR recently registered, render component
  if (user || verifiedStatus === true || recentlyRegistered || isConfidentRecentRegistration) {
    // If this was triggered by recent registration (and we don't have a user yet), 
    // increase loading time to ensure auto-login completes
    if ((recentlyRegistered || isConfidentRecentRegistration) && !user && !verifiedStatus) {
      console.log("Auto-login still in progress, showing loading state");
      
      // In production, we may need to try to load user data from localStorage
      // as a fallback while the JWT token is validated
      if (isProduction && hasLocalStorageUser) {
        try {
          console.log("In production with localStorage user data - attempting emergency authentication");
          const storedUserData = JSON.parse(localStorage.getItem('movietracker_user')!);
          
          // Update caches with this data to buy time for the real JWT validation to complete
          if (storedUserData) {
            queryClient.setQueryData(["/api/jwt/user"], storedUserData);
            
            // Also check if we have a token but just haven't validated it yet
            const token = getToken();
            if (token) {
              console.log("Found existing JWT token, using stored user data");
            }
          }
        } catch (e) {
          console.error("Failed to recover user from localStorage", e);
        }
      }
      
      return (
        <Route path={path}>
          <div className="flex items-center justify-center min-h-screen">
            <Loader2 className="h-8 w-8 animate-spin text-border" />
            <span className="ml-2 text-muted-foreground">
              {isProduction ? "Finalizing your registration..." : "Setting up your account..."}
            </span>
          </div>
        </Route>
      );
    }
    
    return (
      <Route path={path}>
        <Component />
      </Route>
    );
  }

  // Otherwise, redirect to auth page
  return (
    <Route path={path}>
      <Redirect to="/auth" />
    </Route>
  );
}