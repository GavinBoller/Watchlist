import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Film, Tv2, Menu } from 'lucide-react';
import MovieCard from '@/components/MovieCard';
import { AddToWatchlistModal } from '@/components/AddToWatchlistModal';
import { DetailsModal } from '@/components/DetailsModal';
import { TMDBMovie } from '@shared/schema';
import { searchMovies } from '@/api/tmdb';
import { useUserContext } from '@/lib/user-context';
import { useToast } from '@/hooks/use-toast';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';

type MediaFilterType = 'all' | 'movie' | 'tv';

const SearchPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilterType>('all');
  const [selectedItem, setSelectedItem] = useState<TMDBMovie | null>(null);
  const [isWatchlistModalOpen, setIsWatchlistModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const { currentUser } = useUserContext();
  const { toast } = useToast();

  // Search query with error handling
  const { data: searchResults, isLoading, error: searchError } = useQuery({ 
    queryKey: ['/api/movies/search', searchQuery, mediaFilter],
    queryFn: async () => {
      try {
        const results = await searchMovies(searchQuery, mediaFilter);
        
        // Sanitize results to ensure they have the minimal required properties
        if (results && results.results) {
          results.results = results.results
            .filter(item => 
              item && 
              typeof item === 'object' && 
              item.id && 
              (item.title || item.name)
            )
            .map(item => ({
              ...item,
              // Ensure media_type is always set
              media_type: item.media_type || (item.title ? 'movie' : 'tv'),
              // Make sure vote_average is a number or null
              vote_average: typeof item.vote_average === 'number' 
                ? item.vote_average 
                : (item.vote_average ? parseFloat(String(item.vote_average)) : null),
              // Ensure genre_ids is always an array
              genre_ids: Array.isArray(item.genre_ids) 
                ? item.genre_ids 
                : (typeof item.genre_ids === 'string' 
                  ? item.genre_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id))
                  : [])
            }));
        }
        
        return results;
      } catch (error) {
        console.error('Search query error:', error);
        // Return a valid empty response structure rather than throwing
        return { page: 1, results: [], total_results: 0, total_pages: 0 };
      }
    },
    enabled: !!searchQuery,
    retry: 1, // Only retry once to avoid hammering the API
  });

  // Filter results by media type if needed
  const filteredResults = searchResults?.results?.filter(item => {
    // Basic validation of each item in the results
    if (!item || typeof item !== 'object') {
      console.warn('Invalid item in search results:', item);
      return false;
    }
    
    // Only include items with valid id and title/name
    if (!item.id || (!item.title && !item.name)) {
      console.warn('Item missing required fields:', item);
      return false;
    }
    
    // If all validation passes, apply the media type filter
    if (mediaFilter === 'all') return true;
    const itemType = item.media_type || (item.title ? 'movie' : 'tv');
    return itemType === mediaFilter;
  }) || [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      setSearchQuery(searchTerm.trim());
    }
  };

  const handleAddToWatchlist = (item: TMDBMovie) => {
    if (!currentUser) {
      toast({
        title: "No user selected",
        description: "Please select a user before adding to your watched list",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedItem(item);
    setIsWatchlistModalOpen(true);
  };

  const handleShowDetails = (item: TMDBMovie) => {
    setSelectedItem(item);
    setIsDetailsModalOpen(true);
  };

  const mediaTypeFilters = [
    { value: 'all', label: 'All', icon: Menu },
    { value: 'movie', label: 'Movies', icon: Film },
    { value: 'tv', label: 'TV Shows', icon: Tv2 },
  ];

  return (
    <div>
      {/* Introduction Text */}
      <div className="max-w-2xl mx-auto text-center mt-6 mb-6 px-3">
        <h2 className="text-lg sm:text-xl font-bold">
          Search for movies and TV shows to get started
        </h2>
      </div>

      {/* Search Bar */}
      <div className="max-w-2xl mx-auto mb-4 px-3">
        <form className="relative" onSubmit={handleSearch}>
          <Input
            type="text"
            placeholder="Search for movies or TV shows..."
            className="w-full bg-[#292929] text-white border border-gray-700 rounded-lg py-3 px-4 pl-10 focus:outline-none focus:ring-2 focus:ring-[#E50914]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoComplete="off"
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <Button 
            type="submit"
            className="absolute inset-y-0 right-0 flex items-center px-4 text-white bg-[#E50914] rounded-r-lg hover:bg-red-700 focus:outline-none"
          >
            <span className="hidden sm:inline">Search</span>
            <Search className="h-5 w-5 sm:hidden" />
          </Button>
        </form>
      </div>

      {/* Desktop Media Type Filter */}
      <div className="hidden md:flex justify-center mb-6">
        <div className="inline-flex items-center rounded-lg bg-[#292929] p-1">
          {mediaTypeFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.value}
                className={`flex items-center px-3 py-2 text-sm rounded-md transition ${
                  mediaFilter === filter.value 
                    ? 'bg-[#E50914] text-white' 
                    : 'text-gray-300 hover:text-white'
                }`}
                onClick={() => setMediaFilter(filter.value as MediaFilterType)}
              >
                <Icon className="h-4 w-4 mr-2" />
                {filter.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile Media Type Filter - iOS-friendly segmented control */}
      <div className="md:hidden mb-4 px-3">
        <div className="grid grid-cols-3 gap-1 bg-[#292929] rounded-lg p-1 shadow-inner">
          {mediaTypeFilters.map((filter) => {
            const Icon = filter.icon;
            return (
              <button
                key={filter.value}
                className={`flex items-center justify-center px-2 py-2.5 rounded-md text-sm transition ${
                  mediaFilter === filter.value 
                    ? 'bg-[#3d3d3d] text-white font-medium shadow-sm' 
                    : 'text-gray-300 hover:bg-[#3d3d3d]/50'
                }`}
                onClick={() => setMediaFilter(filter.value as MediaFilterType)}
              >
                <Icon className={`h-4 w-4 mr-1.5 ${mediaFilter === filter.value ? 'text-[#E50914]' : ''}`} />
                <span>{filter.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Results */}
      <div className="mt-4 px-3">
        <h2 className={`text-lg sm:text-xl font-bold mb-4 ${searchQuery ? '' : 'hidden'}`}>
          {searchQuery && `${filteredResults?.length || 0} Results for "${searchQuery}"`}
        </h2>
        
        {searchError ? (
          // Error state
          <div className="text-center py-10 text-gray-400 flex flex-col items-center">
            <div className="bg-red-900/30 rounded-lg p-4 max-w-md mx-auto mb-4">
              <p className="text-white font-medium mb-2">Error loading search results</p>
              <p className="text-sm text-gray-300">Please try again or try a different search term.</p>
            </div>
            <Button 
              variant="outline" 
              className="mt-2 bg-[#1a1a1a] hover:bg-[#3d3d3d] border-gray-700"
              onClick={() => {
                if (searchTerm) {
                  setSearchQuery(searchTerm);
                }
              }}
            >
              Try Again
            </Button>
          </div>
        ) : isLoading ? (
          // Skeleton loading state - optimized for mobile
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="rounded-lg overflow-hidden">
                <Skeleton className="w-full aspect-[2/3]" />
              </div>
            ))}
          </div>
        ) : filteredResults && filteredResults.length > 0 ? (
          // Search results
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {filteredResults.map((item) => (
              <MovieCard 
                key={item.id} 
                movie={item} 
                onAddToWatchlist={handleAddToWatchlist}
                onShowDetails={handleShowDetails}
              />
            ))}
          </div>
        ) : searchQuery ? (
          // No results message
          <div className="text-center py-10 text-gray-400 flex flex-col items-center">
            <Search className="h-10 w-10 mb-3 text-gray-600" />
            <p>
              {mediaFilter === 'all' 
                ? `No results found for "${searchQuery}"`
                : `No ${mediaFilter === 'movie' ? 'movies' : 'TV shows'} found for "${searchQuery}"`
              }
            </p>
            <p className="text-sm mt-2 max-w-md">
              Try different keywords or check your spelling
            </p>
          </div>
        ) : (
          // Initial state - suggestions
          <div className="text-center py-8">
            <div className="max-w-md mx-auto bg-[#292929] rounded-lg p-4">
              <Film className="h-8 w-8 mx-auto mb-3 text-[#E50914]" />
              <p className="text-gray-300 mb-4">
                Enter a movie or TV show title in the search box to begin exploring
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Button 
                  variant="outline" 
                  className="bg-[#1a1a1a] hover:bg-[#3d3d3d] border-gray-700"
                  onClick={() => {
                    setSearchTerm("Marvel");
                    setSearchQuery("Marvel");
                  }}
                >
                  Try "Marvel"
                </Button>
                <Button 
                  variant="outline" 
                  className="bg-[#1a1a1a] hover:bg-[#3d3d3d] border-gray-700"
                  onClick={() => {
                    setSearchTerm("Star Wars");
                    setSearchQuery("Star Wars");
                  }}
                >
                  Try "Star Wars"
                </Button>
                <Button 
                  variant="outline" 
                  className="bg-[#1a1a1a] hover:bg-[#3d3d3d] border-gray-700"
                  onClick={() => {
                    setSearchTerm("Breaking Bad");
                    setSearchQuery("Breaking Bad");
                  }}
                >
                  Try "Breaking Bad"
                </Button>
                <Button 
                  variant="outline" 
                  className="bg-[#1a1a1a] hover:bg-[#3d3d3d] border-gray-700"
                  onClick={() => {
                    setSearchTerm("Stranger Things");
                    setSearchQuery("Stranger Things");
                  }}
                >
                  Try "Stranger Things"
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add to Watched Modal */}
      <AddToWatchlistModal 
        item={selectedItem} 
        isOpen={isWatchlistModalOpen} 
        onClose={() => setIsWatchlistModalOpen(false)} 
      />

      {/* Details Modal */}
      <DetailsModal 
        item={selectedItem}
        isOpen={isDetailsModalOpen}
        onClose={() => setIsDetailsModalOpen(false)}
        showAddToWatchlistButton={true}
        onAddToWatchlist={handleAddToWatchlist}
      />
    </div>
  );
};

export default SearchPage;
