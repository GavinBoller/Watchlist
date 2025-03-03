import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient, apiRequest } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Header from "@/components/Header";
import SearchPage from "@/pages/SearchPage";
import WatchlistPage from "@/pages/WatchlistPage";
import { UserContext } from "@/components/UserSelector";
import { UserResponse } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

function App() {
  // Authentication state
  const [currentUser, setCurrentUser] = useState<UserResponse | null>(null);
  const [location, setLocation] = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { toast } = useToast();

  // Check for existing session on mount
  useEffect(() => {
    async function checkSession() {
      try {
        // Use our improved apiRequest utility with retry capability
        const response = await fetch("/api/auth/session", {
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
          }
        });
        
        console.log("Session check status:", response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log("Session check response:", data);
          if (data.authenticated && data.user) {
            setCurrentUser(data.user);
            setIsAuthenticated(true);
          }
        } else {
          console.log("Session check failed with status:", response.status);
          // Try the fallback endpoint if the main one fails
          checkSessionFallback();
        }
      } catch (error) {
        console.error("Failed to check session:", error);
        // Try the fallback endpoint if the main one fails
        checkSessionFallback();
      }
    }
    
    // Some applications use a different endpoint
    async function checkSessionFallback() {
      try {
        const response = await fetch("/api/user", {
          credentials: "include",
          headers: {
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
          }
        });
        
        if (response.ok) {
          const user = await response.json();
          console.log("Session fallback response:", user);
          if (user && user.id) {
            setCurrentUser(user);
            setIsAuthenticated(true);
          }
        }
      } catch (fallbackError) {
        console.error("Failed fallback session check:", fallbackError);
      }
    }
    
    checkSession();
  }, []);

  // Login function
  const login = (user: UserResponse) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
  };

  // Logout function
  const logout = async () => {
    try {
      const response = await apiRequest("POST", "/api/auth/logout");
      console.log("Logout successful");
      setCurrentUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error("Failed to logout:", error);
      toast({
        title: "Error",
        description: "Failed to log out. Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  return (
    <QueryClientProvider client={queryClient}>
      <UserContext.Provider 
        value={{ 
          currentUser, 
          setCurrentUser, 
          login, 
          logout,
          isAuthenticated
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
          
          <main className="flex-grow container mx-auto px-4 py-6">
            <Switch>
              <Route path="/" component={SearchPage} />
              <Route path="/watched" component={WatchlistPage} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
        <Toaster />
      </UserContext.Provider>
    </QueryClientProvider>
  );
}

export default App;
