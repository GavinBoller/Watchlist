import { createContext, useContext, useState, useRef } from 'react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { NewUserModal } from './NewUserModal';

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
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!currentUser) return null;

  return (
    <div className={`relative ${isMobile ? '' : 'hidden md:block'}`}>
      <DropdownMenu>
        <DropdownMenuTrigger 
          ref={triggerRef}
          className="flex items-center space-x-2 bg-[#292929] rounded-full px-3 py-1"
        >
          <span>{currentUser.username}</span>
          <ChevronDown className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-[#292929] text-white border-gray-700">
          {users.map(user => (
            <DropdownMenuItem
              key={user.id}
              className="text-white hover:bg-[#E50914] cursor-pointer"
              onClick={() => setCurrentUser(user)}
            >
              {user.username}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="bg-gray-700" />
          <DropdownMenuItem
            className="text-[#44C8E8] hover:bg-[#E50914] hover:text-white cursor-pointer"
            onClick={() => setIsNewUserModalOpen(true)}
          >
            + Add New User
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
