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

// Bridge component to connect new AuthProvider with legacy UserContext
function AuthBridge({ children }: { children: React.ReactNode }) {
  const { user, loginMutation, logoutMutation } = useAuth();
  
  const userContextValue = {
    currentUser: user,
    setCurrentUser: (newUser: any) => {
      console.log("setCurrentUser called with", newUser);
      // This won't be used anymore since we're using the auth hook
    },
    login: (user: any) => {
      console.log("Legacy login called with", user);
      // User already handled by the auth hook
    },
    logout: async () => {
      console.log("Legacy logout called");
      return logoutMutation.mutateAsync();
    },
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
