import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';
import MovieCard from '@/components/MovieCard';
import { AddToWatchlistModal } from '@/components/AddToWatchlistModal';
import { TMDBMovie } from '@shared/schema';
import { searchMovies } from '@/api/tmdb';
import { useUserContext } from '@/components/UserSelector';
import { useToast } from '@/hooks/use-toast';

const SearchPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMovie, setSelectedMovie] = useState<TMDBMovie | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { currentUser } = useUserContext();
  const { toast } = useToast();

  // Search query
  const { data: searchResults, isLoading } = useQuery({ 
    queryKey: ['/api/movies/search', searchQuery],
    queryFn: () => searchMovies(searchQuery),
    enabled: !!searchQuery,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      setSearchQuery(searchTerm.trim());
    }
  };

  const handleAddToWatchlist = (movie: TMDBMovie) => {
    if (!currentUser) {
      toast({
        title: "No user selected",
        description: "Please select a user before adding to watchlist",
        variant: "destructive",
      });
      return;
    }
    
    setSelectedMovie(movie);
    setIsModalOpen(true);
  };

  return (
    <div>
      {/* Search Bar */}
      <div className="max-w-2xl mx-auto mb-8">
        <form className="relative" onSubmit={handleSearch}>
          <Input
            type="text"
            placeholder="Search for movies..."
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

      {/* Search Results */}
      <div className="mt-8">
        <h2 className={`text-xl font-bold mb-4 ${searchQuery ? '' : 'opacity-50'}`}>
          {searchQuery ? 'Search Results' : 'Search for movies to get started'}
        </h2>
        
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(10)].map((_, index) => (
              <div key={index} className="rounded-lg overflow-hidden">
                <Skeleton className="w-full aspect-[2/3]" />
              </div>
            ))}
          </div>
        ) : searchResults?.results && searchResults.results.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {searchResults.results.map((movie) => (
              <MovieCard 
                key={movie.id} 
                movie={movie} 
                onAddToWatchlist={handleAddToWatchlist} 
              />
            ))}
          </div>
        ) : searchQuery ? (
          <div className="text-center py-10 text-gray-400">
            No movies found for "{searchQuery}"
          </div>
        ) : null}
      </div>

      {/* Add to Watchlist Modal */}
      <AddToWatchlistModal 
        movie={selectedMovie} 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />
    </div>
  );
};

export default SearchPage;
