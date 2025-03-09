import { useState, useRef, useEffect } from 'react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose
} from '@/components/ui/sheet';
import { ChevronDown, UserCircle, Users, LogOut, LockKeyhole } from 'lucide-react';
import { AuthModal } from './AuthModal';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { useJwtAuth } from '../hooks/use-jwt-auth';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { UserResponse } from '@shared/schema';
import { useContext } from 'react';
import { JwtAuthContext } from '../hooks/use-jwt-auth';

// Use the UserContext from the separate file
import { UserContext } from '@/lib/user-context';

interface UserSelectorProps {
  isMobile?: boolean;
}

const UserSelector = ({ isMobile = false }: UserSelectorProps) => {
  // Use the auth context directly
  const auth = useContext(JwtAuthContext);
  if (!auth) {
    throw new Error("UserSelector must be used within a JwtAuthProvider");
  }
  
  const { user, logoutMutation } = auth;
  const [cachedUser, setCachedUser] = useState<UserResponse | null>(null);
  
  // Use a local state to prevent stale UI when authentication changes
  useEffect(() => {
    // Only update if user exists to prevent flicker during logout
    if (user) {
      setCachedUser(user);
    }
  }, [user]);
  
  // A user is authenticated if both the auth context says so and we have a local cached user
  const isAuthenticated = !!user && !!cachedUser;
  
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actualIsMobile = useIsMobile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Force close sheet if window resizes from mobile to desktop
  useEffect(() => {
    if (!actualIsMobile) {
      setSheetOpen(false);
    }
  }, [actualIsMobile]);

  // CROSS-ENVIRONMENT UNIVERSAL LOGOUT SOLUTION
  const handleLogout = async () => {
    // Immediately clear the local cached user to update UI
    setCachedUser(null);
    
    // Import environment utilities
    const {
      isProductionEnvironment,
      getEnvironmentName,
      clearAllClientSideStorage,
      getLogoutConfig
    } = await import('../lib/environment-utils');
    
    const isProd = isProductionEnvironment();
    console.log(`Logout initiated in ${getEnvironmentName()} environment`);
    
    // STEP 0: Directly clear auth state
    try {
      // Reset cached user locally
      setCachedUser(null);
      
      // Clear JWT token immediately from memory/session/local storage
      sessionStorage.removeItem('jwt_token');
      localStorage.removeItem('jwt_token');
      document.cookie = 'jwt_token=; path=/; max-age=0';
      document.cookie = 'watchlist.sid=; path=/; max-age=0';
      
      // Reset query data immediately
      queryClient.setQueryData(["/api/jwt/user"], null);
      
      // Force React Query to recognize the user is logged out
      queryClient.invalidateQueries({ queryKey: ["/api/jwt/user"] });
      
      // Reset logoutMutation state 
      logoutMutation.reset();
    } catch (e) {
      console.error("Error during immediate auth state reset:", e);
    }
    
    // STEP 1: Show overlay for visual feedback
    const overlayDiv = document.createElement('div');
    overlayDiv.style.position = 'fixed';
    overlayDiv.style.top = '0';
    overlayDiv.style.left = '0';
    overlayDiv.style.width = '100%';
    overlayDiv.style.height = '100%';
    overlayDiv.style.backgroundColor = '#141414';
    overlayDiv.style.zIndex = '10000';
    overlayDiv.style.display = 'flex';
    overlayDiv.style.flexDirection = 'column';
    overlayDiv.style.alignItems = 'center';
    overlayDiv.style.justifyContent = 'center';
    overlayDiv.style.padding = '20px';
    overlayDiv.style.opacity = '1'; // Start visible immediately
    
    // Add loading indicator
    overlayDiv.innerHTML = `
      <div style="width: 100%; max-width: 400px; margin: 0 auto; text-align: center;">
        <h1 style="margin-bottom: 20px; font-size: 24px; color: white;">Logging Out</h1>
        <div style="margin-bottom: 20px; text-align: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E50914" stroke-width="2" class="spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
          <style>
            .spin {
              animation: spin 1.5s linear infinite;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </div>
        <p style="color: #888; margin-bottom: 20px;" id="logout-status">Securely logging you out...</p>
      </div>
    `;
    
    document.body.appendChild(overlayDiv);
    
    // STEP 2: Clear all client-side state using our consolidated utility
    clearAllClientSideStorage();
    
    // Additional step: Clear React Query cache (not handled by the util)
    try {
      // Clear the entire cache first
      queryClient.clear();
      
      // Then explicitly set user data to null
      queryClient.setQueryData(["/api/user"], null);
      
      // Don't use invalidation as it might trigger refetches
      // Just remove the query from cache entirely
      queryClient.removeQueries({ queryKey: ["/api/user"] });
    } catch (e) {
      console.error("Error clearing query cache:", e);
    }
    
    // Update status
    const statusElement = document.getElementById('logout-status');
    if (statusElement) {
      statusElement.textContent = "Contacting server...";
    }
    
    // STEP 3: Contact the server for logout (with environment-specific behavior)
    try {
      // Always initiate server logout
      const logoutPromise = fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      });
      
      // Only wait for completion in development
      if (!isProd) {
        // In development, we can wait for the server response
        const response = await logoutPromise;
        
        if (response.ok) {
          console.log("Server-side logout successful");
        } else {
          console.warn("Server-side logout returned non-200 status");
        }
      }
    } catch (err) {
      console.error("Error during server logout:", err);
      // Continue regardless of error
    }
    
    // Update status for user feedback
    if (statusElement) {
      statusElement.textContent = "Redirecting to login...";
    }
    
    // STEP 4: Environment-specific redirects
    const { authUrl, params, useIframe } = getLogoutConfig();
    
    // In production, use the iframe technique for additional reliability
    if (useIframe) {
      // Create a hidden iframe to preload the auth page
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = authUrl;
      document.body.appendChild(iframe);
      
      // Delay redirect slightly to allow iframe to initialize
      setTimeout(() => {
        window.location.href = authUrl;
      }, 300);
      
      return; // Exit early in production
    }
    
    // For development, use the more controlled form submission approach
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = '/auth';
    form.style.display = 'none';
    
    // Add all parameters from our environment config
    Object.entries(params).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
    
    document.body.appendChild(form);
    
    // STEP 5: Perform the actual redirect
    try {
      // Try form submission first (most reliable)
      form.submit();
      
      // Fallback: use direct navigation after a short delay
      setTimeout(() => {
        window.location.href = authUrl;
      }, 100);
    } catch (e) {
      console.error("Form submit failed:", e);
      // Direct fallback
      window.location.href = authUrl;
    }
  };

  // Handle login modal
  const handleLoginModal = () => {
    setIsAuthModalOpen(true);
    setSheetOpen(false);
  };

  // Get display name from the new auth system
  const displayName = user?.displayName || user?.username || "Guest";

  // Use a bottom sheet for mobile devices
  if (actualIsMobile && isMobile) {
    return (
      <div className="relative">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button className="flex items-center space-x-2 bg-[#292929] rounded-full px-3 py-1">
              <UserCircle className="h-5 w-5 text-[#E50914]" />
              <span className="max-w-[100px] truncate">{isAuthenticated ? displayName : "Sign In"}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="bg-[#292929] text-white border-t border-gray-700 rounded-t-xl px-0">
            <SheetHeader className="px-4">
              <SheetTitle className="text-center text-white flex items-center justify-center">
                <Users className="h-5 w-5 mr-2 text-[#E50914]" />
                {isAuthenticated ? "Account" : "Sign In"}
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-1">
              {isAuthenticated ? (
                <>
                  <SheetClose asChild>
                    <Button
                      variant="ghost" 
                      className="w-full justify-start px-4 py-3 text-white"
                      disabled
                    >
                      <UserCircle className="h-5 w-5 mr-3 text-[#E50914]" />
                      {displayName}
                    </Button>
                  </SheetClose>
                  <Button 
                    variant="ghost" 
                    className="w-full justify-start px-4 py-3 text-red-400 hover:bg-red-900 hover:text-white"
                    onClick={handleLogout}
                  >
                    <LogOut className="h-5 w-5 mr-3" />
                    Sign Out
                  </Button>
                </>
              ) : (
                <Button 
                  variant="ghost" 
                  className="w-full justify-start px-4 py-3 text-[#44C8E8] hover:bg-[#E50914] hover:text-white"
                  onClick={handleLoginModal}
                >
                  <LockKeyhole className="h-5 w-5 mr-3" />
                  Sign In / Register
                </Button>
              )}
            </div>
          </SheetContent>
        </Sheet>

        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={() => setIsAuthModalOpen(false)}
          onAuthSuccess={() => {}} // Will be handled by the context
        />
      </div>
    );
  }

  // Use the dropdown menu for desktop
  return (
    <div className={`relative ${isMobile ? '' : 'hidden md:block'}`}>
      <DropdownMenu>
        <DropdownMenuTrigger 
          ref={triggerRef}
          className="flex items-center space-x-2 bg-[#292929] rounded-full px-3 py-1"
        >
          <UserCircle className="h-5 w-5 text-[#E50914]" />
          <span>{isAuthenticated ? displayName : "Sign In"}</span>
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#292929] text-white border-gray-700">
          {isAuthenticated ? (
            <>
              <DropdownMenuItem
                className="text-white cursor-default"
                disabled
              >
                <UserCircle className="h-4 w-4 mr-2 text-[#E50914]" />
                {displayName}
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-700" />
              <DropdownMenuItem
                className="text-red-400 hover:bg-red-900 hover:text-white cursor-pointer"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              className="text-[#44C8E8] hover:bg-[#E50914] hover:text-white cursor-pointer"
              onClick={handleLoginModal}
            >
              <LockKeyhole className="h-4 w-4 mr-2" />
              Sign In / Register
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={() => {}} // Will be handled by the context
      />
    </div>
  );
};

export default UserSelector;
