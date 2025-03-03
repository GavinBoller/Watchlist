import { createContext, useContext, useState, useRef, useEffect } from 'react';
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
import { ChevronDown, UserCircle, Users, PlusCircle } from 'lucide-react';
import { NewUserModal } from './NewUserModal';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';

export interface User {
  id: number;
  username: string;
}

interface UserContextType {
  currentUser: User | null;
  setCurrentUser: (user: User) => void;
  users: User[];
  addUser: (username: string) => Promise<boolean>;
}

// Create context with default values
export const UserContext = createContext<UserContextType>({
  currentUser: null,
  setCurrentUser: () => {},
  users: [],
  addUser: async () => false,
});

export const useUserContext = () => useContext(UserContext);

interface UserSelectorProps {
  isMobile?: boolean;
}

const UserSelector = ({ isMobile = false }: UserSelectorProps) => {
  const { currentUser, setCurrentUser, users } = useUserContext();
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const actualIsMobile = useIsMobile();
  
  // Force close sheet if window resizes from mobile to desktop
  useEffect(() => {
    if (!actualIsMobile) {
      setSheetOpen(false);
    }
  }, [actualIsMobile]);

  if (!currentUser) return null;

  // Handle selecting a user
  const handleSelectUser = (user: User) => {
    setCurrentUser(user);
    setSheetOpen(false);
  };

  // Handle opening new user modal
  const handleNewUser = () => {
    setIsNewUserModalOpen(true);
    setSheetOpen(false);
  };

  // Use a bottom sheet for mobile devices
  if (actualIsMobile && isMobile) {
    return (
      <div className="relative">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button className="flex items-center space-x-2 bg-[#292929] rounded-full px-3 py-1">
              <UserCircle className="h-5 w-5 text-[#E50914]" />
              <span className="max-w-[100px] truncate">{currentUser.username}</span>
              <ChevronDown className="h-4 w-4" />
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="bg-[#292929] text-white border-t border-gray-700 rounded-t-xl px-0">
            <SheetHeader className="px-4">
              <SheetTitle className="text-center text-white flex items-center justify-center">
                <Users className="h-5 w-5 mr-2 text-[#E50914]" />
                Select User
              </SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-1">
              {users.map(user => (
                <SheetClose asChild key={user.id}>
                  <Button
                    variant="ghost" 
                    className={`w-full justify-start px-4 py-3 ${
                      currentUser.id === user.id 
                        ? 'bg-[#3d3d3d] text-white' 
                        : 'text-gray-300 hover:bg-[#3d3d3d] hover:text-white'
                    }`}
                    onClick={() => handleSelectUser(user)}
                  >
                    <UserCircle className={`h-5 w-5 mr-3 ${currentUser.id === user.id ? 'text-[#E50914]' : ''}`} />
                    {user.username}
                  </Button>
                </SheetClose>
              ))}
              <Button 
                variant="ghost" 
                className="w-full justify-start px-4 py-3 text-[#44C8E8] hover:bg-[#E50914] hover:text-white"
                onClick={handleNewUser}
              >
                <PlusCircle className="h-5 w-5 mr-3" />
                Add New User
              </Button>
            </div>
          </SheetContent>
        </Sheet>

        <NewUserModal 
          isOpen={isNewUserModalOpen} 
          onClose={() => setIsNewUserModalOpen(false)} 
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
          <span>{currentUser.username}</span>
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#292929] text-white border-gray-700">
          {users.map(user => (
            <DropdownMenuItem
              key={user.id}
              className={`text-white hover:bg-[#E50914] cursor-pointer ${
                currentUser.id === user.id ? 'bg-[#3d3d3d]' : ''
              }`}
              onClick={() => setCurrentUser(user)}
            >
              <UserCircle className={`h-4 w-4 mr-2 ${currentUser.id === user.id ? 'text-[#E50914]' : ''}`} />
              {user.username}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="bg-gray-700" />
          <DropdownMenuItem
            className="text-[#44C8E8] hover:bg-[#E50914] hover:text-white cursor-pointer"
            onClick={() => setIsNewUserModalOpen(true)}
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Add New User
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewUserModal 
        isOpen={isNewUserModalOpen} 
        onClose={() => setIsNewUserModalOpen(false)} 
      />
    </div>
  );
};

export default UserSelector;
