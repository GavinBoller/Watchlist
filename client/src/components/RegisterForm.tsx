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
import { isProductionEnvironment } from "@/lib/environment-utils";

interface RegisterFormProps {
  onRegisterSuccess: (user: UserResponse) => void;
  onSwitchToLogin: () => void;
}

export const RegisterForm = ({ onRegisterSuccess, onSwitchToLogin }: RegisterFormProps) => {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const { registerMutation } = useJwtAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isSimpleRegistering, setIsSimpleRegistering] = useState(false);

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
    
    const useSimpleRegistration = shouldUseSimpleRegistration();
    const isProd = isProductionEnvironment();
    
    // Show registration toast
    toast({
      title: "Creating account",
      description: "Setting up your account...",
      duration: 3000,
    });
    
    if (useSimpleRegistration) {
      // Use the simplified registration flow for production
      try {
        setIsSimpleRegistering(true);
        
        const result = await simpleRegister({
          username,
          password,
          displayName: displayName || undefined
        });
        
        // Signal success to parent component
        onRegisterSuccess(result.user);
        
        // Pre-populate the cache with user data
        queryClient.setQueryData(["/api/jwt/user"], result.user);
        
        // Redirect to home page
        setLocation("/");
        
      } catch (error) {
        console.error("Simple registration failed:", error);
        setIsSimpleRegistering(false);
        
        // Show error toast
        toast({
          title: "Registration failed",
          description: error instanceof Error ? error.message : "Could not create account",
          variant: "destructive",
        });
      }
    } else {
      // Standard registration flow for development
      registerMutation.mutate(
        {
          username,
          displayName: displayName || username,
          password,
          confirmPassword
        },
        {
          onSuccess: (data) => {
            console.log("Registration successful");
            
            // Signal success to parent component
            onRegisterSuccess(data.user);
            
            // Store temporary registration data to help with protected routes
            window.__tempRegistrationData = {
              timestamp: Date.now(),
              username: username
            };
            
            // Redirect to home page
            setLocation("/");
          },
          onError: (error: Error) => {
            console.error("Registration error:", error);
          }
        }
      );
    }
  };

  // Track loading state
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