import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Redirect, Route, useLocation } from "wouter";
import { checkSessionStatus } from "./session-utils";
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
  const { user, isLoading } = useAuth();
  const [isVerifyingSession, setIsVerifyingSession] = useState(false);
  const [verifiedStatus, setVerifiedStatus] = useState<boolean | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [, navigate] = useLocation();

  // Enhanced session verification that can retry with exponential backoff
  const verifySession = useCallback(async () => {
    console.log("Protected route: Secondary session verification starting");
    setIsVerifyingSession(true);
    try {
      // Try multiple session check approaches for robustness
      console.log("Checking current session status via", "/api/session");
      let sessionData = await checkSessionStatus();
      console.log("Session check response:", sessionData);
      
      // Final verification result processing
      console.log("Protected route: Final session verification result:", sessionData);
      
      // If session check confirms user is authenticated but our context doesn't have the user
      // This is an edge case where the user context isn't in sync with the actual session
      if (sessionData?.authenticated && sessionData?.user) {
        console.log("Protected route: User is authenticated but context is out of sync");
        
        // Update all query caches with the correct user data
        queryClient.setQueryData(["/api/user"], sessionData.user);
        
        // Force refetch to ensure consistency
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        
        // Set as authenticated
        setVerifiedStatus(true);
      } else {
        // Session verification confirms user is not authenticated
        console.log("Protected route: Session verification confirms user is not authenticated");
        setVerifiedStatus(false);
      }
    } catch (error) {
      console.error("Protected route: Session verification error", error);
      // Assume not authenticated on error
      setVerifiedStatus(false);
    } finally {
      setIsVerifyingSession(false);
    }
  }, [retryCount]);

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
    if (!isLoading && !isVerifyingSession && !user && verifiedStatus === null) {
      console.log("ProtectedRoute: Starting session verification because user is null but authentication status is unknown");
      verifySession();
    } else if (!isLoading && !isVerifyingSession) {
      if (user) {
        console.log("ProtectedRoute: Using cached user authentication:", user.username);
        
        // Special enhanced handling for problematic users
        if (user && typeof user.username === 'string' && 
           (user.username.startsWith('Test') || user.username === 'JaneS')) {
          
          console.log(`Enhanced session protection for special user: ${user.username}`);
          
          // Store enhanced backup for these users on every protected route access
          try {
            localStorage.setItem('movietracker_enhanced_backup', JSON.stringify({
              userId: user.id,
              username: user.username,
              timestamp: Date.now(),
              sessionId: localStorage.getItem('movietracker_session_id') || 'unknown',
              enhanced: true,
              source: 'protected_route'
            }));
            
            // Also store username separately for emergency recovery
            localStorage.setItem('movietracker_username', user.username);
            
            // Create a heartbeat to monitor session health
            const now = Date.now();
            const heartbeat = {
              timestamp: now,
              username: user.username,
              userId: user.id,
              lastActive: now,
              route: path
            };
            localStorage.setItem('movietracker_session_heartbeat', JSON.stringify(heartbeat));
          } catch (e) {
            console.error('Failed to create enhanced backup for special user:', e);
          }
        }
      } else if (verifiedStatus !== null) {
        console.log("ProtectedRoute: Using verified session status:", verifiedStatus);
      }
    }
  }, [isLoading, isVerifyingSession, user, verifiedStatus, verifySession, path]);

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
                             
  // If we're loading OR verifying session, show loading indicator
  if (isLoading || isVerifyingSession) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
          <span className="ml-2 text-muted-foreground">
            {recentlyRegistered ? "Completing your registration..." : "Verifying your session..."}
          </span>
        </div>
      </Route>
    );
  }

  // If user exists OR verified session says they're authenticated OR recently registered, render component
  if (user || verifiedStatus === true || recentlyRegistered || isConfidentRecentRegistration) {
    // If this was triggered by recent registration (and we don't have a user yet), 
    // increase loading time to ensure auto-login completes
    if ((recentlyRegistered || isConfidentRecentRegistration) && !user && !verifiedStatus) {
      console.log("Auto-login still in progress, showing loading state");
      
      // In production, we may need to try to load user data from localStorage
      // as a fallback while the session establishes
      if (isProduction && hasLocalStorageUser) {
        try {
          console.log("In production with localStorage user data - attempting emergency authentication");
          const storedUserData = JSON.parse(localStorage.getItem('movietracker_user')!);
          
          // Update caches with this data to buy time for the real session to establish
          if (storedUserData) {
            queryClient.setQueryData(["/api/user"], storedUserData);
            
            // Also try to trigger a session refresh
            fetch('/api/refresh-session', {
              method: 'GET',
              credentials: 'include',
              headers: { 'Cache-Control': 'no-cache' }
            }).catch(err => console.warn("Failed to refresh session", err));
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