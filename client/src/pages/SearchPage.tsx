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
import { useUserContext } from '@/components/UserSelector';
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

  // Search query
  const { data: searchResults, isLoading } = useQuery({ 
    queryKey: ['/api/movies/search', searchQuery, mediaFilter],
    queryFn: () => searchMovies(searchQuery, mediaFilter),
    enabled: !!searchQuery,
  });

  // Filter results by media type if needed
  const filteredResults = searchResults?.results.filter(item => {
    if (mediaFilter === 'all') return true;
    const itemType = item.media_type || (item.title ? 'movie' : 'tv');
    return itemType === mediaFilter;
  });

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
      {/* Search Bar */}
      <div className="max-w-2xl mx-auto mb-6">
        <form className="relative" onSubmit={handleSearch}>
          <Input
            type="text"
            placeholder="Search for movies or TV shows..."
            className="w-full bg-[#292929] text-white border border-gray-700 rounded-lg py-3 px-4 pl-10 focus:outline-none focus:ring-2 focus:ring-[#E50914]"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <Button 
            type="submit"
            className="absolute inset-y-0 right-0 flex items-center px-4 text-white bg-[#E50914] rounded-r-lg hover:bg-red-700 focus:outline-none"
          >
            Search
          </Button>
        </form>
      </div>

      {/* Media Type Filter */}
      <div className="flex justify-center mb-6">
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

      {/* Mobile Media Type Filter */}
      <div className="md:hidden flex justify-center mb-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="bg-[#292929] border-gray-700">
              <span className="mr-2">
                {mediaTypeFilters.find(f => f.value === mediaFilter)?.label || 'Filter'}
              </span>
              {(() => {
                const Icon = mediaTypeFilters.find(f => f.value === mediaFilter)?.icon || Menu;
                return <Icon className="h-4 w-4" />;
              })()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="bg-[#292929] text-white border-gray-700">
            {mediaTypeFilters.map((filter) => {
              const Icon = filter.icon;
              return (
                <DropdownMenuItem 
                  key={filter.value}
                  className={`flex items-center cursor-pointer ${
                    mediaFilter === filter.value ? 'bg-[#E50914] text-white' : ''
                  }`}
                  onClick={() => setMediaFilter(filter.value as MediaFilterType)}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {filter.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search Results */}
      <div className="mt-4">
        <h2 className={`text-xl font-bold mb-4 ${searchQuery ? '' : 'opacity-50'}`}>
          {searchQuery 
            ? `${filteredResults?.length || 0} Results for "${searchQuery}"` 
            : 'Search for movies and TV shows to get started'}
        </h2>
        
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="rounded-lg overflow-hidden">
                <Skeleton className="w-full aspect-[2/3]" />
              </div>
            ))}
          </div>
        ) : filteredResults && filteredResults.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
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
          <div className="text-center py-10 text-gray-400">
            {mediaFilter === 'all' 
              ? `No results found for "${searchQuery}"`
              : `No ${mediaFilter === 'movie' ? 'movies' : 'TV shows'} found for "${searchQuery}"`
            }
          </div>
        ) : null}
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
        onAddToWatchlist={handleAddToWatchlist}
      />
    </div>
  );
};

export default SearchPage;
