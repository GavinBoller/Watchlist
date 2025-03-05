import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Redirect, Route, useLocation } from "wouter";
import { checkSessionStatus } from "./session-utils";
import { queryClient } from "./queryClient";

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
      // Double-check the session status directly
      console.log("Checking current session status via", "/api/session");
      const sessionData = await checkSessionStatus();
      console.log("Session check response:", sessionData);
      console.log("Protected route: Session verification result:", sessionData);
      
      // If session check confirms user is authenticated but our context doesn't have the user
      // This is an edge case where the user context isn't in sync with the actual session
      if (sessionData?.authenticated && sessionData?.user) {
        console.log("Protected route: User is authenticated but context is out of sync");
        // Force refetch the user query to sync the context
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        // Don't redirect yet
        setVerifiedStatus(true);
      } else {
        // Session verification confirms user is not authenticated
        console.log("Protected route: Session verification confirms user is not authenticated");
        setVerifiedStatus(false);
      }
    } catch (error) {
      console.error("Protected route: Session verification error", error);
      
      // If we haven't retried too many times, schedule another attempt with backoff
      if (retryCount < 2) { // limit to 2 retries (3 attempts total)
        const nextRetry = retryCount + 1;
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff capped at 5s
        
        console.log(`Protected route: Scheduling retry ${nextRetry} in ${delay}ms`);
        setRetryCount(nextRetry);
        
        setTimeout(() => {
          // Reset verification status to trigger another attempt
          setIsVerifyingSession(false);
          setVerifiedStatus(null);
        }, delay);
      } else {
        console.log("Protected route: Max retries reached, assuming not authenticated");
        setVerifiedStatus(false);
      }
    } finally {
      setIsVerifyingSession(false);
    }
  }, [retryCount]);

  // Secondary verification for edge cases where useAuth might report incorrect state
  useEffect(() => {
    // Only verify if not already loading, not already verifying, and user is null (potentially false negative)
    if (!isLoading && !isVerifyingSession && !user && verifiedStatus === null) {
      verifySession();
    }
  }, [isLoading, isVerifyingSession, user, verifiedStatus, verifySession]);

  // If we're loading OR verifying session, show loading indicator
  if (isLoading || isVerifyingSession) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
          <span className="ml-2 text-muted-foreground">Verifying your session...</span>
        </div>
      </Route>
    );
  }

  // If user exists OR verified session says they're authenticated, render component
  if (user || verifiedStatus === true) {
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