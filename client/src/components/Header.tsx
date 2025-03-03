import UserSelector from "./UserSelector";
import { Montserrat } from 'next/font/google';

const montserrat = {
  className: 'font-heading',
  subsets: ['latin'],
  variable: '--font-montserrat',
};

interface HeaderProps {
  onTabChange: (tab: "search" | "watchlist") => void;
  activeTab: "search" | "watchlist";
}

const Header = ({ onTabChange, activeTab }: HeaderProps) => {
  return (
    <header className="bg-[#141414] border-b border-[#292929] sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between">
        <div className="flex items-center justify-between mb-2 md:mb-0">
          <div className="flex items-center">
            <h1 className={`text-2xl font-bold text-[#E50914] ${montserrat.className}`}>MovieTracker</h1>
          </div>
          
          {/* Mobile user selector */}
          <UserSelector isMobile={true} />
        </div>
        
        <div className="flex flex-col md:flex-row md:items-center md:space-x-6 space-y-2 md:space-y-0">
          {/* Navigation */}
          <nav>
            <ul className="flex space-x-4">
              <li>
                <button 
                  className={`px-1 py-2 font-medium border-b-2 ${
                    activeTab === "search" 
                      ? "border-[#E50914] text-white" 
                      : "border-transparent text-[#E5E5E5] hover:text-white transition"
                  }`}
                  onClick={() => onTabChange("search")}
                >
                  Search
                </button>
              </li>
              <li>
                <button 
                  className={`px-1 py-2 font-medium border-b-2 ${
                    activeTab === "watchlist" 
                      ? "border-[#E50914] text-white" 
                      : "border-transparent text-[#E5E5E5] hover:text-white transition"
                  }`}
                  onClick={() => onTabChange("watchlist")}
                >
                  Watched
                </button>
              </li>
            </ul>
          </nav>
          
          {/* Desktop user selector */}
          <UserSelector />
        </div>
      </div>
    </header>
  );
};

export default Header;
