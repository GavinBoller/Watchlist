import React, { useEffect } from "react";
import { useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Header from "@/components/Header";
import SearchPage from "@/pages/SearchPage";
import WatchlistPage from "@/pages/WatchlistPage";
import AuthPage from "@/pages/auth-page";
import AdminDashboardPage from "@/pages/AdminDashboardPage";
import { UserContext } from "@/lib/user-context";
import { Switch, Route } from "wouter";
import { JwtAuthProvider, useJwtAuth } from "@/hooks/use-jwt-auth";
import { ProtectedRoute } from "./lib/protected-route";
import EmergencyAuth, { setupEmergencyAuth } from "./components/EmergencyAuth";

/**
 * Internal app structure with authentication-aware components
 * This component must be rendered inside the AuthProvider
 */
function AppInternal() {
  const [location, setLocation] = useLocation();
  const { user, logoutMutation } = useJwtAuth();
  
  // Prepare the user context value for backward compatibility
  const userContextValue = {
    currentUser: user,
    setCurrentUser: () => {}, // Deprecated
    login: () => {}, // Deprecated
    logout: () => logoutMutation.mutateAsync(),
    isAuthenticated: !!user
  };
  
  return (
    <UserContext.Provider value={userContextValue}>
      <div className="flex flex-col min-h-screen">
        <Header 
          onTabChange={(tab) => {
            if (tab === "search") {
              setLocation("/");
            } else if (tab === "watchlist") {
              setLocation("/watched");
            }
          }}
          activeTab={location === "/" ? "search" : "watchlist"}
        />
        
        <main className="flex-grow">
          <Switch>
            <ProtectedRoute path="/" component={SearchPage} />
            <ProtectedRoute path="/watched" component={WatchlistPage} />
            <ProtectedRoute path="/admin" component={AdminDashboardPage} />
            <Route path="/auth" component={AuthPage} />
            {/* API paths should be ignored by the client-side router */}
            <Route path="/api/:rest*">
              {() => {
                // This is just a placeholder that will never be rendered
                // API requests will be handled by the server
                return null;
              }}
            </Route>
            <Route component={NotFound} />
          </Switch>
        </main>
        <Toaster />
      </div>
    </UserContext.Provider>
  );
}

/**
 * Main App component with all providers set up
 * This ensures correct provider nesting and prevents context errors
 */
function App() {
  // Initialize emergency auth mechanism when app loads
  useEffect(() => {
    setupEmergencyAuth();
    console.log('[EMERGENCY] Emergency auth system initialized');
  }, []);
  
  return (
    <QueryClientProvider client={queryClient}>
      <JwtAuthProvider>
        <AppInternal />
        <EmergencyAuth showDebug={false} />
      </JwtAuthProvider>
    </QueryClientProvider>
  );
}

export default App;
