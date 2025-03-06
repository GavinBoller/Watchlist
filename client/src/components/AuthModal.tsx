import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoginForm } from "./LoginForm";
import { RegisterForm } from "./RegisterForm";
import { PasswordResetForm } from "./PasswordResetForm";
import { UserResponse } from "@shared/schema";
import { useJwtAuth } from '../hooks/use-jwt-auth';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserResponse) => void;
}

type AuthView = "login" | "register" | "passwordReset";

export const AuthModal = ({ isOpen, onClose, onAuthSuccess }: AuthModalProps) => {
  const [view, setView] = useState<AuthView>("login");

  const handleAuthSuccess = (user: UserResponse) => {
    // The user will be set in the auth context automatically by the mutations
    onClose();
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

  // Determine the title based on current view
  const title = view === "login" 
    ? "Welcome Back" 
    : view === "register" 
    ? "Join MovieTracker" 
    : "Reset Password";
    
  // Determine the description based on current view
  const description = view === "login"
    ? "Log in to access your watchlist and track your movies"
    : view === "register"
    ? "Create an account to start tracking your movies and shows"
    : "Reset your password to regain access to your account";

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle id="auth-dialog-title" className="text-center text-2xl">
            {title}
          </DialogTitle>
          <DialogDescription id="auth-dialog-description" className="text-center">
            {description}
          </DialogDescription>
        </DialogHeader>
        
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
      </DialogContent>
    </Dialog>
  );
};