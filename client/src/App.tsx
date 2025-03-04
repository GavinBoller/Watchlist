import { useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Header from "@/components/Header";
import SearchPage from "@/pages/SearchPage";
import WatchlistPage from "@/pages/WatchlistPage";
import AuthPage from "@/pages/auth-page";
import { UserContext } from "@/components/UserSelector";
import { UserResponse } from "@shared/schema";
import { AuthProvider } from "@/hooks/use-auth";
import { ProtectedRoute } from "./lib/protected-route";

function App() {
  // For header tab navigation
  const [location, setLocation] = useLocation();
  
  // Legacy UserContext - we'll update our components to use useAuth hook gradually
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null);
  
  // This is a bridge function between the old UserContext and the new useAuth hook
  // Later we can refactor all components to use useAuth directly
  const login = (user: UserResponse) => {
    setCurrentUser(user);
  };
  
  // Legacy logout function - will be replaced by useAuth's logoutMutation
  const logout = async () => {
    // This will be handled by the AuthProvider
    setCurrentUser(null);
    return Promise.resolve();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <UserContext.Provider 
          value={{ 
            currentUser, 
            setCurrentUser, 
            login, 
            logout,
            isAuthenticated: !!currentUser
          }}
        >
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
          </div>
          <Toaster />
        </UserContext.Provider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
