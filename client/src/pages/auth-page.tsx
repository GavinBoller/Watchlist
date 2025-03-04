import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "../hooks/use-auth";
import { LoginForm } from "@/components/LoginForm";
import { RegisterForm } from "@/components/RegisterForm";
import { PasswordResetForm } from "@/components/PasswordResetForm";
import { UserResponse } from "@shared/schema";

type AuthView = "login" | "register" | "passwordReset";

export default function AuthPage() {
  const [view, setView] = useState<AuthView>("login");
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect to home if already logged in
  useEffect(() => {
    if (user) {
      setLocation("/");
    }
  }, [user, setLocation]);

  const handleAuthSuccess = (user: UserResponse) => {
    // The useAuth hook will handle updating the user state
    // This will trigger the redirect effect above
  };

  const handleSwitchToRegister = () => {
    setView("register");
  };

  const handleSwitchToLogin = () => {
    setView("login");
  };

  const handleSwitchToPasswordReset = () => {
    setView("passwordReset");
  };

  return (
    <div className="w-full min-h-screen flex flex-col md:flex-row">
      {/* Form section */}
      <div className="md:w-1/2 p-6 md:p-10 flex items-center justify-center">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-bold">
              {view === "login" 
                ? "Welcome Back" 
                : view === "register" 
                ? "Create Account" 
                : "Reset Password"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {view === "login"
                ? "Sign in to access your personalized movie watchlist"
                : view === "register"
                ? "Join to start tracking movies and shows you love"
                : "Enter your details to reset your password"}
            </p>
          </div>

          {view === "login" && (
            <LoginForm
              onLoginSuccess={handleAuthSuccess}
              onSwitchToRegister={handleSwitchToRegister}
              onForgotPassword={handleSwitchToPasswordReset}
            />
          )}
          
          {view === "register" && (
            <RegisterForm
              onRegisterSuccess={handleAuthSuccess}
              onSwitchToLogin={handleSwitchToLogin}
            />
          )}
          
          {view === "passwordReset" && (
            <PasswordResetForm
              onBack={handleSwitchToLogin}
            />
          )}
        </div>
      </div>
      
      {/* Hero section */}
      <div className="hidden md:flex md:w-1/2 bg-gradient-to-br from-primary/90 to-primary/50 p-10 flex-col justify-center">
        <div className="max-w-lg">
          <h2 className="text-4xl font-bold text-white mb-6">Discover and Track Your Favorite Movies</h2>
          <ul className="space-y-4">
            <li className="flex items-start">
              <svg className="h-6 w-6 text-white mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-white">Create your personalized watchlist</span>
            </li>
            <li className="flex items-start">
              <svg className="h-6 w-6 text-white mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-white">Track movies you've watched, are watching, or want to watch</span>
            </li>
            <li className="flex items-start">
              <svg className="h-6 w-6 text-white mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-white">Search over 500,000 movies and TV shows</span>
            </li>
            <li className="flex items-start">
              <svg className="h-6 w-6 text-white mr-2 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-white">Keep your watchlist private and secure</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}