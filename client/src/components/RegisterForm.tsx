import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { UserResponse } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";

interface RegisterFormProps {
  onRegisterSuccess: (user: UserResponse) => void;
  onSwitchToLogin: () => void;
}

export const RegisterForm = ({ onRegisterSuccess, onSwitchToLogin }: RegisterFormProps) => {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { registerMutation, loginMutation } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password || !confirmPassword) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    
    if (password !== confirmPassword) {
      toast({
        title: "Error",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }
    
    if (password.length < 6) {
      toast({
        title: "Error",
        description: "Password must be at least 6 characters long",
        variant: "destructive",
      });
      return;
    }
    
    // Store the original password locally for auto-login later
    const originalPassword = password;
    
    registerMutation.mutate(
      {
        username,
        displayName: displayName || username,
        password,
        confirmPassword
      },
      {
        onSuccess: async (user) => {
          console.log("Registration form received success response");
          
          // Signal success to parent component
          onRegisterSuccess(user);
          
          // Critical fix: Wait for session to be established properly
          // This delay allows the server to complete its session setup
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Check if authentication succeeded before redirecting
          try {
            const sessionResponse = await fetch("/api/session", {
              credentials: "include",
              headers: { "Cache-Control": "no-cache" }
            });
            
            if (sessionResponse.ok) {
              const sessionData = await sessionResponse.json();
              console.log("Pre-redirect session check:", sessionData);
              
              if (sessionData.authenticated) {
                console.log("Session authenticated, redirecting to home page");
                setLocation("/");
              } else {
                console.log("Session not authenticated after registration, attempting auto-login");
                
                // Attempt auto-login using the credentials from the registration
                try {
                  console.log("Attempting auto-login after registration");
                  
                  // IMPORTANT: Pre-populate the cache with user data to prevent the login screen flash
                  // This creates the illusion of a seamless transition
                  queryClient.setQueryData(["/api/user"], user);
                  queryClient.setQueryData(["/api/auth/user"], user);
                  
                  // Store temporary registration data to help the protected route
                  // This is used to prevent login page flash during the redirect
                  window.__tempRegistrationData = {
                    timestamp: Date.now(),
                    username: username
                  };
                  
                  // First redirect to home page to prevent the flash of login screen
                  setLocation("/");
                  
                  // Then perform the actual login in the background
                  // This ensures the session is properly established
                  loginMutation.mutate(
                    {
                      username: username,
                      password: originalPassword
                    },
                    {
                      onSuccess: (userData) => {
                        console.log("Auto-login successful after registration");
                        // The user is already on the home page
                      },
                      onError: (error) => {
                        console.error("Auto-login failed after registration:", error);
                        // Don't show an error toast since we already redirected
                        // Just log the error and let the app's session refresh handle it
                      }
                    }
                  );
                } catch (loginError) {
                  console.error("Error during auto-login:", loginError);
                  toast({
                    title: "Login error",
                    description: "Please try logging in manually",
                    variant: "destructive"
                  });
                }
              }
            } else {
              console.error("Failed to verify session before redirect");
              toast({
                title: "Session verification failed",
                description: "Please try logging in manually",
                variant: "destructive"
              });
            }
          } catch (sessionError) {
            console.error("Error checking session before redirect:", sessionError);
            // Fall back to redirecting anyway
            setLocation("/");
          }
        },
        onError: (error: Error) => {
          // Error handling is already done in the mutation
          console.error("Registration error:", error);
        }
      }
    );
  };

  const isLoading = registerMutation.isPending;

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl text-center">Create an Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username*</Label>
            <Input
              id="username"
              placeholder="Choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name (optional)</Label>
            <Input
              id="displayName"
              placeholder="How you want to be called"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              This will be displayed in your profile. If left empty, your username will be used.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="register-password">Password*</Label>
            <Input
              id="register-password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              required
            />
            <p className="text-xs text-muted-foreground">
              Must be at least 6 characters long
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password*</Label>
            <Input
              id="confirm-password"
              type="password"
              placeholder="Confirm your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <div className="flex items-center justify-center">
                <span className="mr-2">Creating Account</span>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              </div>
            ) : "Register"}
          </Button>
          <div className="text-center mt-4">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Button
                variant="link"
                className="p-0 h-auto"
                onClick={onSwitchToLogin}
                type="button"
              >
                Log In
              </Button>
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};