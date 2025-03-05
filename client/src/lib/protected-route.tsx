import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Redirect, Route, useLocation } from "wouter";
import { checkSessionStatus } from "./session-utils";

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
  const [, navigate] = useLocation();

  // Secondary verification for edge cases where useAuth might report incorrect state
  useEffect(() => {
    // Only verify if not already loading and user is null (potentially false negative)
    if (!isLoading && !user && verifiedStatus === null) {
      const verifySession = async () => {
        console.log("Protected route: Secondary session verification starting");
        setIsVerifyingSession(true);
        try {
          // Double-check the session status directly
          const sessionData = await checkSessionStatus();
          console.log("Protected route: Session verification result:", sessionData);
          
          // If session check confirms user is authenticated but our context doesn't have the user
          // This is an edge case where the user context isn't in sync with the actual session
          if (sessionData?.authenticated && sessionData?.user) {
            console.log("Protected route: User is authenticated but context is out of sync");
            // Let's wait for React Query to catch up (it should refetch in background)
            // Don't redirect yet
            setVerifiedStatus(true);
          } else {
            // Session verification confirms user is not authenticated
            console.log("Protected route: Session verification confirms user is not authenticated");
            setVerifiedStatus(false);
          }
        } catch (error) {
          console.error("Protected route: Session verification error", error);
          setVerifiedStatus(false);
        } finally {
          setIsVerifyingSession(false);
        }
      };
      
      verifySession();
    }
  }, [isLoading, user, verifiedStatus]);

  // If we're loading OR verifying session, show loading indicator
  if (isLoading || isVerifyingSession) {
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-8 w-8 animate-spin text-border" />
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