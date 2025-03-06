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

  // IMPROVED LOGOUT HANDLING
  
  // 1. Check URL parameters for special flags and environment detection
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isPreload = urlParams.get('preload') === 'true';
    const fromLogout = urlParams.get('fromLogout') === 'true';
    const forceFlag = urlParams.get('force') === 'true';
    const clearFlag = urlParams.get('clear') === 'true';
    const hardFlag = urlParams.get('hard') === 'true';
    
    // Detect if we're in production
    const isProd = window.location.hostname.includes('replit.app');
    console.log(`Auth page loaded in ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} environment`);
    console.log("URL flags:", { isPreload, fromLogout, forceFlag, clearFlag, hardFlag });
    
    if (isPreload) {
      console.log("Auth page preloaded for faster logout transition");
      // Just preload assets but don't take any action
      return;
    }
    
    // Super aggressive state clearing for production environment
    if (isProd || hardFlag) {
      console.log("APPLYING MAXIMUM STRENGTH COOKIE AND STATE CLEARING");
      
      // 1. Attempt multiple cookie clearing techniques
      // Standard technique
      document.cookie.split(";").forEach(function(c) {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
      
      // Explicit cookie removal with multiple paths
      ["watchlist.sid", "connect.sid", "session"].forEach(name => {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/auth`;
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/api`;
      });
      
      // 2. Clear all localStorage
      try {
        localStorage.clear();
      } catch (e) {
        console.error("Error clearing localStorage:", e);
      }
      
      // 3. Production-specific: Additional logout call in auth page
      if (isProd && (hardFlag || clearFlag)) {
        // Make an extra logout call just to be sure
        console.log("Making additional logout request from auth page");
        fetch('/api/logout', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store',
            'Pragma': 'no-cache'
          },
          cache: 'no-store'
        }).catch(() => {
          // Ignore errors
        });
      }
      
      return;
    }
    
    // Standard cleanup for non-production
    if (fromLogout || forceFlag) {
      console.log("Detected navigation from logout process");
      
      // Clear any lingering localStorage data to ensure clean slate
      for (const key of [
        'movietracker_user', 
        'movietracker_session_id',
        'movietracker_enhanced_backup',
        'movietracker_username',
        'movietracker_last_verified',
        'movietracker_session_heartbeat'
      ]) {
        localStorage.removeItem(key);
      }
      
      // Force clear cookies
      document.cookie.split(";").forEach(function(c) {
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
      });
    }
  }, []);
  
  // 2. Special handler for reloading the page if needed
  // This helps with stubborn session clearing in production
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const reload = urlParams.get('reload') === 'true';
    
    if (reload) {
      // Remove the reload parameter to prevent reload loop
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('reload');
      window.history.replaceState({}, '', newUrl.toString());
      
      // Check if we're in production and might need additional cookie clearing
      if (window.location.hostname.includes('replit.app')) {
        console.log("Production environment detected, applying special cookie clearing...");
        // One more aggressive cookie clear
        const allCookies = document.cookie.split(';');
        for (let i = 0; i < allCookies.length; i++) {
          const cookie = allCookies[i];
          const eqPos = cookie.indexOf('=');
          const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
          document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;';
        }
      }
    }
  }, []);

  // 3. Redirect to home if already logged in and not in preload mode
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const isPreload = urlParams.get('preload') === 'true';
    const force = urlParams.get('force') === 'true';
    
    // If this is a forced auth page visit from logout, don't redirect even if user state is still cached
    if (user && !isPreload && !force) {
      console.log("User still logged in, redirecting to home");
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