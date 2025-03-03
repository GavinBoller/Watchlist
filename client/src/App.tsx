import { useState, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Header from "@/components/Header";
import SearchPage from "@/pages/SearchPage";
import WatchlistPage from "@/pages/WatchlistPage";
import { UserContext, User } from "@/components/UserSelector";

function App() {
  // Current user state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [location, setLocation] = useLocation();

  // Fetch users on mount and load last selected user
  useEffect(() => {
    async function fetchUsers() {
      try {
        const response = await fetch("/api/users");
        if (response.ok) {
          const users = await response.json();
          setUsers(users);
          
          // Try to load last selected user from localStorage
          const lastUserId = localStorage.getItem('lastUserId');
          
          if (lastUserId && users.length > 0) {
            // Find the user with the stored ID
            const lastUser = users.find((user: User) => user.id === parseInt(lastUserId, 10));
            if (lastUser) {
              setCurrentUser(lastUser);
            } else {
              // Fall back to first user if saved user not found
              setCurrentUser(users[0]);
            }
          } else if (users.length > 0) {
            // Default to first user if no saved user
            setCurrentUser(users[0]);
          }
        }
      } catch (error) {
        console.error("Failed to fetch users:", error);
      }
    }
    
    fetchUsers();
  }, []);

  // Add a new user to the users list
  const addUser = async (username: string) => {
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username }),
      });
      
      if (response.ok) {
        const newUser = await response.json();
        setUsers(prevUsers => [...prevUsers, newUser]);
        // Save to localStorage and set as current user
        localStorage.setItem('lastUserId', newUser.id.toString());
        setCurrentUser(newUser);
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Failed to add user:", error);
      return false;
    }
  };

  // Create a wrapper for setCurrentUser that also saves to localStorage
  const setCurrentUserWithStorage = (user: User): void => {
    // Save user ID to localStorage for persistence
    localStorage.setItem('lastUserId', user.id.toString());
    // Update the state
    setCurrentUser(user);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <UserContext.Provider value={{ currentUser, setCurrentUser: setCurrentUserWithStorage, users, addUser }}>
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
