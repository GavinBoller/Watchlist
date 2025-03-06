import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { UserResponse } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

interface LoginFormProps {
  onLoginSuccess: (user: UserResponse) => void;
  onSwitchToRegister: () => void;
  onForgotPassword: () => void;
}

export const LoginForm = ({ onLoginSuccess, onSwitchToRegister, onForgotPassword }: LoginFormProps) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { loginMutation } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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
    
    try {
      toast({
        title: "Logging in",
        description: "Checking your credentials...",
      });
      
      loginMutation.mutate(
        { username, password },
        {
          onSuccess: (user) => {
            // Check if we have a valid user object before proceeding
            if (!user || !user.id || !user.username) {
              console.error("Invalid user data received:", user);
              toast({
                title: "Login error",
                description: "Received invalid user data from server",
                variant: "destructive",
              });
              return;
            }
            
            console.log("Login successful, user data:", user);
            toast({
              title: "Welcome back!",
              description: `You've successfully logged in as ${user.username}`,
            });
            
            onLoginSuccess(user);
            // Redirect to home page after successful login
            setLocation("/");
          },
          onError: (error: Error) => {
            console.error("Login error:", error);
            toast({
              title: "Login failed",
              description: error.message || "There was a problem logging in. Please try again.",
              variant: "destructive",
            });
          }
        }
      );
    } catch (error) {
      console.error("Unexpected error during login:", error);
      toast({
        title: "Login error",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    }
  };

  const isLoading = loginMutation.isPending;

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
            {isLoading ? (
              <div className="flex items-center justify-center">
                <span className="mr-2">Logging in</span>
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
              </div>
            ) : "Log In"}
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