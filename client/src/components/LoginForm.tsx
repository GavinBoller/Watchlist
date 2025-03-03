import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { UserResponse } from "@shared/schema";

interface LoginFormProps {
  onLoginSuccess: (user: UserResponse) => void;
  onSwitchToRegister: () => void;
  onForgotPassword: () => void;
}

export const LoginForm = ({ onLoginSuccess, onSwitchToRegister, onForgotPassword }: LoginFormProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !password) {
      toast({
        title: "Error",
        description: "Please enter both username and password",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      // Use apiRequest instead of fetch for better error handling and consistency
      const response = await apiRequest("POST", "/api/auth/login", { 
        username, 
        password 
      });
      
      // Check HTTP status before parsing JSON to handle non-JSON responses
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid username or password");
        } else if (response.status === 503) {
          throw new Error("Server is temporarily unavailable. Please try again later.");
        } else {
          const errorText = await response.text();
          throw new Error(errorText || `Login failed with status ${response.status}`);
        }
      }
      
      const data = await response.json();
      
      if (!data.user) {
        throw new Error("Login successful but user data is missing");
      }
      
      console.log("Login successful:", data);
      
      toast({
        title: "Welcome Back!",
        description: "You've successfully logged in",
      });
      
      onLoginSuccess(data.user);
    } catch (error: any) {
      console.error("Login error:", error);
      
      // Provide more specific error messages based on error types
      const errorMessage = (() => {
        if (error.message.includes("ECONNREFUSED") || error.message.includes("Failed to fetch")) {
          return "Unable to connect to the server. Please check your internet connection and try again.";
        } else if (error.message.includes("timeout")) {
          return "Request timed out. The server might be busy, please try again later.";
        } else if (error.message.includes("Invalid username or password")) {
          return "Invalid username or password. Please try again.";
        } else {
          return error.message || "Login failed. Please try again.";
        }
      })();
      
      toast({
        title: "Login Failed",
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
        <CardTitle className="text-2xl text-center">Log In to Your Account</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Logging in..." : "Log In"}
          </Button>
          <div className="flex flex-col items-center gap-2 mt-4">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Button
                variant="link"
                className="p-0 h-auto"
                onClick={onSwitchToRegister}
                type="button"
              >
                Register
              </Button>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onForgotPassword}
              type="button"
              className="text-xs"
            >
              Forgot your password?
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};