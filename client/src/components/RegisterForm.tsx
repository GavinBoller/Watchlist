import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { UserResponse } from "@shared/schema";
import { useJwtAuth } from "@/hooks/use-jwt-auth";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { simpleRegister, shouldUseSimpleRegistration } from "@/lib/simpleAuth";

interface RegisterFormProps {
  onRegisterSuccess: (user: UserResponse) => void;
  onSwitchToLogin: () => void;
}

export const RegisterForm = ({ onRegisterSuccess, onSwitchToLogin }: RegisterFormProps) => {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { registerMutation, loginMutation } = useJwtAuth();
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
    
    // Check if we should use the simplified registration process
    // This is mainly for production environments or when previous registration attempts failed
    const useSimpleRegistration = shouldUseSimpleRegistration();
    
    if (useSimpleRegistration) {
      // Try the simplified registration flow first
      console.log("Using simplified registration flow for reliability");
      
      try {
        // Mark UI as loading for simple registration
        setIsSimpleRegistering(true);
        registerMutation.reset();
        
        // Add a visual delay indicator for user feedback
        const registrationPromise = simpleRegister({
          username,
          password,
          displayName: displayName || undefined
        });
        
        // Show a toast for better user feedback
        toast({
          title: "Registering account",
          description: "Creating your account...",
          duration: 5000,
        });
        
        // Await the registration result
        const result = await registrationPromise;
        
        console.log("Simplified registration successful");
        
        // Extract user from the response
        const user = result.user;
        
        // Signal success to parent component
        onRegisterSuccess(user);
        
        // Pre-populate the cache with user data
        queryClient.setQueryData(["/api/user"], user);
        queryClient.setQueryData(["/api/jwt/user"], user);
        
        // Store temporary registration data
        window.__tempRegistrationData = {
          timestamp: Date.now(),
          username: username
        };
        
        // Store user data in localStorage as a backup
        try {
          localStorage.setItem('movietracker_user', JSON.stringify(user));
          localStorage.setItem('movietracker_registration_time', Date.now().toString());
          localStorage.setItem('movietracker_username', username);
          console.log("Stored user data in localStorage for session persistence backup");
        } catch (storageError) {
          console.error("Failed to store user data in localStorage:", storageError);
        }
        
        // Immediate redirect to home page
        setLocation("/");
        
        return; // Exit early since registration was successful
      } catch (error) {
        console.error("Simplified registration failed, falling back to standard registration:", error);
        // Store registration failure in localStorage so we can use simple registration next time
        localStorage.setItem('registration_failure', 'true');
        
        // Always reset loading state when there's an error
        setIsSimpleRegistering(false);
        
        // Get a better error message
        const errorMessage = error instanceof Error 
          ? error.message 
          : "Registration failed. Please try again.";
        
        // Check for specific 501 Not Implemented error which means the endpoint isn't available in production
        const is501Error = errorMessage.includes('501') || errorMessage.includes('Not Implemented');
        
        // Fall back to standard registration below
        toast({
          title: is501Error 
            ? "Using alternative registration method" 
            : "Initial registration attempt failed",
          description: errorMessage.includes('Username already exists')
            ? "Username already exists, please choose another."
            : is501Error
              ? "The first method wasn't available, trying another way..."
              : "Trying alternative registration method...",
          variant: is501Error ? "default" : "destructive",
        });
      }
    }
    
    // If simple registration failed or is not being used, try standard registration
    console.log("Using standard registration flow");
    registerMutation.mutate(
      {
        username,
        displayName: displayName || username,
        password,
        confirmPassword
      },
      {
        onSuccess: async (data) => {
          console.log("Registration form received success response");
          
          // Extract user from the JWT response
          const user = data.user;
          
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
                  queryClient.setQueryData(["/api/jwt/user"], user);
                  queryClient.setQueryData(["/api/auth/user"], user);
                  
                  // Store temporary registration data to help the protected route
                  // This is used to prevent login page flash during the redirect
                  window.__tempRegistrationData = {
                    timestamp: Date.now(),
                    username: username
                  };
                  
                  // Also store user data in localStorage as a backup for production environments
                  // This helps with session persistence across redirects
                  try {
                    localStorage.setItem('movietracker_user', JSON.stringify(user));
                    // Store the registration time to help identify new users for enhanced protection
                    localStorage.setItem('movietracker_registration_time', Date.now().toString());
                    localStorage.setItem('movietracker_username', username);
                    console.log("Stored user data in localStorage for session persistence backup");
                  } catch (storageError) {
                    console.error("Failed to store user data in localStorage:", storageError);
                  }
                  
                  // Increase auto-login delay in production to ensure session is properly established
                  const isProduction = window.location.hostname.includes('.replit.app') || 
                                      !window.location.hostname.includes('localhost');
                  if (isProduction) {
                    console.log("Production environment detected, adding additional session establishment delay");
                    await new Promise(resolve => setTimeout(resolve, 800));
                  }
                  
                  // First redirect to home page to prevent the flash of login screen
                  setLocation("/");
                  
                  // Then perform the actual login in the background with multiple retries for production
                  // This ensures the session is properly established
                  const performLoginWithRetries = async (maxRetries = 3) => {
                    let loginSuccess = false;
                    let lastError;
                    
                    for (let retry = 0; retry < maxRetries; retry++) {
                      try {
                        if (retry > 0) {
                          console.log(`Auto-login retry ${retry+1}/${maxRetries}`);
                          // Add increasing delay between retries
                          await new Promise(resolve => setTimeout(resolve, 500 * retry));
                        }
                        
                        const loginResult = await new Promise<any>((resolve, reject) => {
                          loginMutation.mutate(
                            {
                              username: username,
                              password: originalPassword
                            },
                            {
                              onSuccess: (loginResponse) => resolve(loginResponse),
                              onError: (error) => reject(error)
                            }
                          );
                        });
                        
                        console.log("Auto-login successful after registration");
                        loginSuccess = true;
                        break;
                      } catch (error) {
                        lastError = error;
                        console.error(`Auto-login attempt ${retry+1} failed:`, error);
                      }
                    }
                    
                    if (!loginSuccess) {
                      console.error("All auto-login attempts failed after registration:", lastError);
                      // Don't show a visible error since we already redirected
                    }
                  };
                  
                  // Start the login process in the background but don't await it
                  // so we can redirect the user immediately
                  performLoginWithRetries(isProduction ? 5 : 3);
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

  // Track loading state for both registration methods
  const [isSimpleRegistering, setIsSimpleRegistering] = useState(false);
  const isLoading = registerMutation.isPending || isSimpleRegistering;

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