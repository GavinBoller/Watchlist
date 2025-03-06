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

  // Direct hard logout for immediate effect without waiting
  const handleLogout = () => {
    // Clear all toast notifications first
    // This prevents any residual UI from remaining visible
    queryClient.clear();
    
    // 1. Mark intentional logout in localStorage
    localStorage.setItem('movietracker_intentional_logout_time', Date.now().toString());
    
    // 2. Clear all session-related data from localStorage
    localStorage.removeItem('movietracker_user');
    localStorage.removeItem('movietracker_session_id');
    localStorage.removeItem('movietracker_enhanced_backup');
    localStorage.removeItem('movietracker_username');
    localStorage.removeItem('movietracker_last_verified');
    localStorage.removeItem('movietracker_session_heartbeat');
    
    // 3. Clear React Query cache immediately
    queryClient.setQueryData(["/api/user"], null);
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    
    // 4. Set a cookie to indicate logout (helps with session clearing)
    document.cookie = "logout_time=" + Date.now() + "; path=/; max-age=5";
    
    // 5. Send a background logout request to the server
    const logoutRequest = new XMLHttpRequest();
    logoutRequest.open('POST', '/api/logout', true); // async=true
    logoutRequest.send();
    
    // 6. Redirect immediately to auth page with hard navigation
    window.location.href = '/auth?timestamp=' + Date.now(); // Add timestamp to prevent caching
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
