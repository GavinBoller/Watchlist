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
import { useAuth } from '../hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { UserResponse } from '@shared/schema';
import { useContext } from 'react';
import { AuthContext } from '../hooks/use-auth';

// Keep this line to maintain compatibility with other components
export const useUserContext = () => {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("useUserContext must be used within an AuthProvider");
  }
  
  return {
    currentUser: auth.user,
    setCurrentUser: () => {}, // Deprecated
    login: () => {}, // Deprecated
    logout: auth.logoutMutation.mutateAsync,
    isAuthenticated: !!auth.user
  };
};

// Re-export UserContext for other components that use it
import { createContext } from 'react';
export const UserContext = createContext<any>(null);

interface UserSelectorProps {
  isMobile?: boolean;
}

const UserSelector = ({ isMobile = false }: UserSelectorProps) => {
  // Use the auth context directly
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error("UserSelector must be used within an AuthProvider");
  }
  
  const { user, logoutMutation } = auth;
  const isAuthenticated = !!user;
  
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

  // PRODUCTION-SAFE SOLUTION: Works in both DEV and PROD environments
  const handleLogout = async () => {
    // Show overlay immediately for visual feedback
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
    overlayDiv.style.transition = 'opacity 0.2s';
    overlayDiv.style.opacity = '0';
    
    // Add loading indicator and message
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
        <p style="color: #888; margin-bottom: 20px;">Securely logging you out...</p>
      </div>
    `;
    
    document.body.appendChild(overlayDiv);
    
    // Fade in the overlay
    setTimeout(() => {
      overlayDiv.style.opacity = '1';
    }, 10);
    
    // Complete client-side cleanup
    // 1. Clear local storage
    localStorage.setItem('movietracker_intentional_logout_time', Date.now().toString());
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
    
    // 2. Clear React Query cache
    queryClient.clear();
    queryClient.setQueryData(["/api/user"], null);
    
    // 3. Clear cookies (will work in both DEV and PROD)
    document.cookie.split(";").forEach(function(c) {
      document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
    
    // 4. Force logout on server with synchronous request (wait for completion)
    try {
      const response = await fetch('/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      });
      
      if (response.ok) {
        console.log("Server-side logout successful");
      } else {
        console.warn("Server-side logout returned non-200 status");
      }
    } catch (err) {
      console.error("Error during server logout:", err);
    }
    
    // 5. Redirect to auth page
    // Use multiple approaches for maximum reliability
    
    // Method 1: Update location with cache busting
    const timestamp = Date.now();
    const authUrl = `/auth?force=true&t=${timestamp}`;
    
    // Method 2: Form submit approach
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = '/auth';
    form.style.display = 'none';
    
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'force';
    input.value = 'true';
    form.appendChild(input);
    
    const timeInput = document.createElement('input');
    timeInput.type = 'hidden';
    timeInput.name = 't';
    timeInput.value = timestamp.toString();
    form.appendChild(timeInput);
    
    // Add a special flag for production environment
    const prodInput = document.createElement('input');
    prodInput.type = 'hidden';
    prodInput.name = 'fromLogout';
    prodInput.value = 'true';
    form.appendChild(prodInput);
    
    document.body.appendChild(form);
    
    // Method 3: Force a hard refresh
    const performHardRedirect = () => {
      window.location.href = authUrl;
      // If that doesn't work, try hard reload
      setTimeout(() => {
        window.location.replace(authUrl);
        // Absolute last resort - hard reload
        setTimeout(() => {
          window.location.href = authUrl + "&reload=true";
          window.location.reload();
        }, 100);
      }, 100);
    };
    
    // Submit the form which is most reliable in production
    try {
      form.submit();
      // Back up with location change if form submit doesn't trigger navigation
      setTimeout(performHardRedirect, 200);
    } catch (e) {
      console.error("Form submit failed:", e);
      performHardRedirect();
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
