import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useJwtAuth } from "../hooks/use-jwt-auth";
import { LoginForm } from "@/components/LoginForm";
import { RegisterForm } from "@/components/RegisterForm";
import { PasswordResetForm } from "@/components/PasswordResetForm";
import { UserResponse } from "@shared/schema";

// Add TypeScript interface for window global state
declare global {
  interface Window {
    __authBackup?: {
      userId: number;
      username: string;
      timestamp: number;
    } | null;
  }
}

type AuthView = "login" | "register" | "passwordReset";

export default function AuthPage() {
  const [view, setView] = useState<AuthView>("login");
  const { user } = useJwtAuth();
  const [, setLocation] = useLocation();

  // IMPROVED LOGOUT HANDLING
  
  // 1. Handle URL parameters with environment-aware behavior
  useEffect(() => {
    const loadEnvironmentUtils = async () => {
      // Import environment utilities dynamically
      const {
        isProductionEnvironment,
        getEnvironmentName,
        clearAllClientSideStorage
      } = await import('../lib/environment-utils');
      
      // Get URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const isPreload = urlParams.get('preload') === 'true';
      const fromLogout = urlParams.get('fromLogout') === 'true';
      const forceFlag = urlParams.get('force') === 'true';
      const clearFlag = urlParams.get('clear') === 'true';
      const hardFlag = urlParams.get('hard') === 'true';
      
      // Environment detection
      const isProd = isProductionEnvironment();
      console.log(`Auth page loaded in ${getEnvironmentName()} environment`);
      console.log("URL flags:", { isPreload, fromLogout, forceFlag, clearFlag, hardFlag });
      
      // Check if we just came from logout
      let justLoggedOut = false;
      try {
        justLoggedOut = localStorage.getItem('jusT_logged_out') === 'true' || 
                         sessionStorage.getItem('jusT_logged_out') === 'true';
                         
        // Clear the flag immediately
        localStorage.removeItem('jusT_logged_out');
        sessionStorage.removeItem('jusT_logged_out');
        
        if (justLoggedOut) {
          console.log("Detected recent logout - will forcibly clear state");
        }
      } catch (e) {
        console.error("Error checking logout flag:", e);
      }
      
      // Preload mode - just load assets but take no action
      if (isPreload) {
        console.log("Auth page preloaded for faster logout transition");
        return;
      }
      
      // Determine if we need to clear state - now also check for direct logout flag
      const needStateClear = isProd || hardFlag || clearFlag || fromLogout || forceFlag || justLoggedOut;
      
      // In development, ALWAYS clear state to prevent lingering issues
      if (!isProd || needStateClear) {
        console.log(`Clearing client-side state in ${getEnvironmentName()} environment`);
        
        // Use our centralized utility for consistent behavior
        clearAllClientSideStorage();
        
        // Also clear any cached auth state
        try {
          // Clear tokens
          localStorage.removeItem('jwt_token');
          sessionStorage.removeItem('jwt_token');
          
          // Clear cookies
          document.cookie = 'jwt_token=; path=/; max-age=0';
          document.cookie = 'watchlist.sid=; path=/; max-age=0';
          
          // Clear any backup auth data
          localStorage.removeItem('auth_backup');
          sessionStorage.removeItem('auth_backup');
          
          // Loop through storage to clear any tokens
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes('token') || key.includes('user') || key.includes('auth'))) {
              localStorage.removeItem(key);
            }
          }
          
          // Clear window.__authBackup if it exists
          if (window.__authBackup) {
            try {
              delete window.__authBackup;
            } catch (e) {
              window.__authBackup = null;
            }
          }
        } catch (e) {
          console.error("Error clearing auth state:", e);
        }
        
        // Production and hard mode: make an additional server call
        if ((isProd || hardFlag || justLoggedOut) && !isPreload) {
          console.log("Making additional logout request from auth page");
          try {
            // Use fire-and-forget pattern to avoid waiting
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
              // Ignore errors intentionally
            });
          } catch (e) {
            // Ignore all errors in production mode
            console.error("Error during additional logout:", e);
          }
        }
      }
    };
    
    // Execute the async function
    loadEnvironmentUtils();
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
          
          {/* Help text for login issues */}
          <div className="mt-6 pt-6 border-t border-border">
            <h3 className="text-sm font-medium mb-2">Having trouble logging in?</h3>
            <p className="text-xs text-muted-foreground mb-2">
              If you're experiencing login issues, try resetting your password or clearing your browser cache.
            </p>
          </div>
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