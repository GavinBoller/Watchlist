import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { UserResponse } from "@shared/schema";

interface RegisterFormProps {
  onRegisterSuccess: (user: UserResponse) => void;
  onSwitchToLogin: () => void;
}

export const RegisterForm = ({ onRegisterSuccess, onSwitchToLogin }: RegisterFormProps) => {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

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
    
    setIsLoading(true);
    
    try {
      // Use apiRequest instead of fetch for better error handling and consistency
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        displayName: displayName || username,
        password,
        confirmPassword
      });
      
      const data = await response.json();
      
      console.log("Registration response:", data);
      
      // Check for specific error conditions in the response
      if (response.status >= 400) {
        // Handle the error based on the response from the server
        if (response.status === 409) {
          throw new Error("Username already exists. Please choose another one.");
        } else if (response.status === 503) {
          throw new Error("Server is temporarily unavailable. Please try again later.");
        } else {
          throw new Error(data.message || "Registration failed");
        }
      }
      
      // Handle case where registration succeeded but auto-login failed
      if (data.loginSuccessful === false) {
        toast({
          title: "Account Created",
          description: "Your account was created successfully, but we couldn't log you in automatically. Please log in manually.",
          duration: 5000,
        });
        // Switch to login view
        onSwitchToLogin();
        return;
      }
      
      toast({
        title: "Success",
        description: "Account created and logged in successfully!",
      });
      
      onRegisterSuccess(data.user);
    } catch (error: any) {
      console.error("Registration error:", error);
      
      // Provide more specific error messages based on error types
      const errorMessage = (() => {
        if (error.message.includes("ECONNREFUSED") || error.message.includes("Failed to fetch")) {
          return "Unable to connect to the server. Please check your internet connection and try again.";
        } else if (error.message.includes("timeout")) {
          return "Request timed out. The server might be busy, please try again later.";
        } else {
          return error.message || "Registration failed. Please try again.";
        }
      })();
      
      toast({
        title: "Registration Failed",
        description: errorMessage,
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsLoading(false);
    }
  };

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
            {isLoading ? "Creating Account..." : "Register"}
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