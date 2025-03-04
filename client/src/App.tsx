import { useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Header from "@/components/Header";
import SearchPage from "@/pages/SearchPage";
import WatchlistPage from "@/pages/WatchlistPage";
import AuthPage from "@/pages/auth-page";
import { UserContext } from "@/components/UserSelector";
import { Switch, Route } from "wouter";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";

// This is now a simplified component since all components use useAuth directly
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { user, logoutMutation } = useAuth();
  
  // Keep providing UserContext for backward compatibility
  // but all components should migrate to useAuth directly
  const userContextValue = {
    currentUser: user,
    setCurrentUser: () => {}, // Deprecated
    login: () => {}, // Deprecated
    logout: () => logoutMutation.mutateAsync(),
    isAuthenticated: !!user
  };
  
  return (
    <UserContext.Provider value={userContextValue}>
      {children}
    </UserContext.Provider>
  );
}

function AppContent() {
  // For header tab navigation
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  
  return (
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
          <Route path="/auth" component={AuthPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <Toaster />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthBridge>
          <AppContent />
        </AuthBridge>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
