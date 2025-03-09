import UserSelector from "./UserSelector";
import { useIsMobile } from "@/hooks/use-mobile";
import { Search, List, Film, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

interface HeaderProps {
  onTabChange: (tab: "search" | "watchlist") => void;
  activeTab: "search" | "watchlist";
}

const Header = ({ onTabChange, activeTab }: HeaderProps) => {
  const isMobile = useIsMobile();
  const [isEmergencyMode, setIsEmergencyMode] = useState(false);
  
  // Check if we're using emergency authentication
  useEffect(() => {
    const checkEmergencyMode = () => {
      try {
        // Check URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const emergencyLogin = urlParams.get('emergencyLogin') === 'true';
        const directAuth = urlParams.get('directAuth') === 'true';
        
        // Check session storage
        const storedEmergencyAuth = sessionStorage.getItem('emergency_auth') === 'true';
        
        // Set emergency mode if any emergency login method is active
        setIsEmergencyMode(emergencyLogin || directAuth || storedEmergencyAuth);
      } catch (e) {
        console.error('[EMERGENCY] Error checking emergency mode:', e);
      }
    };
    
    // Run check immediately and also when URL changes
    checkEmergencyMode();
    
    window.addEventListener('popstate', checkEmergencyMode);
    return () => window.removeEventListener('popstate', checkEmergencyMode);
  }, []);

  return (
    <header className="bg-[#141414] border-b border-[#292929] sticky top-0 z-50 ios-safe-area-padding">
      <div className="container mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between">
        <div className="flex items-center justify-between mb-2 md:mb-0">
          <div className="flex items-center">
            <Film className="h-6 w-6 text-[#E50914] mr-2" />
            <h1 className="text-xl sm:text-2xl font-bold text-[#E50914] tracking-tight">MovieTracker</h1>
            
            {/* Emergency mode indicator */}
            {isEmergencyMode && (
              <div className="ml-2 flex items-center bg-yellow-700/30 text-yellow-500 text-xs px-2 py-1 rounded-md">
                <AlertTriangle className="h-3 w-3 mr-1" />
                <span>Emergency Mode</span>
              </div>
            )}
          </div>
          
          {/* Mobile user selector */}
          <UserSelector isMobile={true} />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center md:space-x-6 space-y-2 md:space-y-0">
          {/* Navigation */}
          <nav className="w-full">
            {isMobile ? (
              // Mobile navigation - full width tab buttons with icons
              <ul className="grid grid-cols-2 gap-1 bg-[#1a1a1a] rounded-lg p-1">
                <li className="w-full">
                  <button 
                    className={`w-full rounded-md py-2 flex items-center justify-center text-center ${
                      activeTab === "search" 
                        ? "bg-[#292929] text-white font-medium" 
                        : "text-[#E5E5E5] hover:bg-[#292929]/50"
                    }`}
                    onClick={() => onTabChange("search")}
                    aria-label="Search tab"
                  >
                    <Search className={`h-4 w-4 mr-2 ${activeTab === "search" ? "text-[#E50914]" : ""}`} />
                    <span>Search</span>
                  </button>
                </li>
                <li className="w-full">
                  <button 
                    className={`w-full rounded-md py-2 flex items-center justify-center text-center ${
                      activeTab === "watchlist" 
                        ? "bg-[#292929] text-white font-medium" 
                        : "text-[#E5E5E5] hover:bg-[#292929]/50"
                    }`}
                    onClick={() => onTabChange("watchlist")}
                    aria-label="Watchlist tab"
                  >
                    <List className={`h-4 w-4 mr-2 ${activeTab === "watchlist" ? "text-[#E50914]" : ""}`} />
                    <span>Watched</span>
                  </button>
                </li>
              </ul>
            ) : (
              // Desktop navigation - underlined tabs
              <ul className="flex space-x-4">
                <li>
                  <button 
                    className={`px-1 py-2 font-medium border-b-2 flex items-center ${
                      activeTab === "search" 
                        ? "border-[#E50914] text-white" 
                        : "border-transparent text-[#E5E5E5] hover:text-white transition"
                    }`}
                    onClick={() => onTabChange("search")}
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </button>
                </li>
                <li>
                  <button 
                    className={`px-1 py-2 font-medium border-b-2 flex items-center ${
                      activeTab === "watchlist" 
                        ? "border-[#E50914] text-white" 
                        : "border-transparent text-[#E5E5E5] hover:text-white transition"
                    }`}
                    onClick={() => onTabChange("watchlist")}
                  >
                    <List className="h-4 w-4 mr-2" />
                    Watched
                  </button>
                </li>
              </ul>
            )}
          </nav>
          
          {/* Desktop user selector */}
          {!isMobile && <UserSelector />}
        </div>
      </div>
    </header>
  );
};

export default Header;
