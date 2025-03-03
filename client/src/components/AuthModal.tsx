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
import { UserResponse } from "@shared/schema";
import { useUserContext } from "./UserSelector";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (user: UserResponse) => void;
}

type AuthView = "login" | "register";

export const AuthModal = ({ isOpen, onClose, onAuthSuccess }: AuthModalProps) => {
  const [view, setView] = useState<AuthView>("login");
  const { login } = useUserContext();

  const handleAuthSuccess = (user: UserResponse) => {
    login(user);
    onClose();
  };

  const handleSwitchView = () => {
    setView(view === "login" ? "register" : "login");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center text-2xl">
            {view === "login" ? "Welcome Back" : "Join MovieTracker"}
          </DialogTitle>
          <DialogDescription className="text-center">
            {view === "login"
              ? "Log in to access your watchlist and track your movies"
              : "Create an account to start tracking your movies and shows"}
          </DialogDescription>
        </DialogHeader>
        
        {view === "login" ? (
          <LoginForm
            onLoginSuccess={handleAuthSuccess}
            onSwitchToRegister={handleSwitchView}
          />
        ) : (
          <RegisterForm
            onRegisterSuccess={handleAuthSuccess}
            onSwitchToLogin={handleSwitchView}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};