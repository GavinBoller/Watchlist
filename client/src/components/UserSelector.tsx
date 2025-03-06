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

  // ULTIMATE SOLUTION: Direct page replacement for immediate logout
  const handleLogout = () => {
    // 1. Mark intentional logout in localStorage and clear all data
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
    
    // 2. Clear all caches
    queryClient.clear();
    queryClient.setQueryData(["/api/user"], null);
    
    // 3. Create an overlay that displays the login form immediately
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
    overlayDiv.style.overflow = 'auto';
    
    // 4. Create a basic login form in the overlay
    overlayDiv.innerHTML = `
      <div style="width: 100%; max-width: 400px; margin: 0 auto; text-align: center;">
        <h1 style="margin-bottom: 20px; font-size: 24px; color: white;">Log in to MovieTracker</h1>
        <div style="margin-bottom: 20px; text-align: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#E50914" stroke-width="2">
            <path d="M19 2H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z"></path>
            <path d="M7 2v20"></path>
            <path d="M17 2v20"></path>
            <path d="M2 12h20"></path>
            <path d="M2 7h5"></path>
            <path d="M2 17h5"></path>
            <path d="M17 17h5"></path>
            <path d="M17 7h5"></path>
          </svg>
        </div>
        <p style="color: #888; margin-bottom: 20px;">Logging out and redirecting to login page...</p>
      </div>
    `;
    
    document.body.appendChild(overlayDiv);
    
    // 5. Start two parallel processes
    // A. Logout request in the background
    fetch('/api/logout', { 
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    }).catch(() => {
      // Ignore errors, we're redirecting anyway
    });
    
    // B. Hard redirect to auth page (with bypasses for caching)
    document.cookie = "logout_time=" + Date.now() + "; path=/; max-age=5";
    
    // Load login page in the background to prime the cache
    const hiddenFrame = document.createElement('iframe');
    hiddenFrame.style.width = '0';
    hiddenFrame.style.height = '0';
    hiddenFrame.style.border = 'none';
    hiddenFrame.style.position = 'absolute';
    hiddenFrame.src = '/auth?preload=true&t=' + Date.now();
    document.body.appendChild(hiddenFrame);
    
    // Create a form submit to navigate (most reliable method)
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = '/auth';
    form.style.display = 'none';
    
    // Add timestamp to prevent caching
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 't';
    input.value = Date.now().toString();
    form.appendChild(input);
    
    document.body.appendChild(form);
    
    // Submit the form after a very brief delay to ensure overlay is displayed
    setTimeout(() => {
      form.submit();
      
      // Fallback in case form submit fails
      setTimeout(() => {
        window.location.href = '/auth?force=true&t=' + Date.now();
      }, 100);
    }, 50);
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
