import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUserContext } from '@/components/UserSelector';
import WatchlistEntry from '@/components/WatchlistEntry';
import { DetailsModal } from '@/components/DetailsModal';
import { TMDBMovie, WatchlistEntryWithMovie } from '@shared/schema';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Film, Tv2, Menu, BadgePlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type MediaFilterType = 'all' | 'movie' | 'tv';

const WatchlistPage = () => {
  const { currentUser } = useUserContext();
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaFilterType>('all');
  const [sortOrder, setSortOrder] = useState<string>('date_desc');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<WatchlistEntryWithMovie | null>(null);
  const [editWatchedDate, setEditWatchedDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WatchlistEntryWithMovie | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const { toast } = useToast();

  // Fetch watchlist
  const { data: watchlist, isLoading } = useQuery({ 
    queryKey: currentUser ? [`/api/watchlist/${currentUser.id}`] : [],
    enabled: !!currentUser,
  });

  // Filter and sort watchlist
  const filteredAndSortedWatchlist = () => {
    if (!watchlist) return [];

    // First filter by media type and genre
    let filtered = watchlist;
    
    // Filter by media type
    if (mediaTypeFilter !== 'all') {
      filtered = filtered.filter(entry => 
        entry.movie.mediaType === mediaTypeFilter
      );
    }
    
    // Filter by genre
    if (selectedGenre && selectedGenre !== 'all') {
      filtered = filtered.filter(entry => 
        entry.movie.genres?.includes(selectedGenre)
      );
    }

    // Then sort
    return [...filtered].sort((a, b) => {
      switch (sortOrder) {
        case 'date_desc':
          return new Date(b.watchedDate || 0).getTime() - new Date(a.watchedDate || 0).getTime();
        case 'date_asc':
          return new Date(a.watchedDate || 0).getTime() - new Date(b.watchedDate || 0).getTime();
        case 'title_asc':
          return a.movie.title.localeCompare(b.movie.title);
        case 'title_desc':
          return b.movie.title.localeCompare(a.movie.title);
        case 'rating_desc':
          return parseFloat(b.movie.voteAverage || '0') - parseFloat(a.movie.voteAverage || '0');
        default:
          return 0;
      }
    });
  };

  // Handle edit entry
  const handleEditEntry = (entry: WatchlistEntryWithMovie) => {
    setEntryToEdit(entry);
    setEditWatchedDate(entry.watchedDate ? format(new Date(entry.watchedDate), 'yyyy-MM-dd') : '');
    setEditNotes(entry.notes || '');
    setIsEditModalOpen(true);
  };

  // Handle showing details
  const handleShowDetails = (entry: WatchlistEntryWithMovie) => {
    setSelectedEntry(entry);
    setIsDetailsModalOpen(true);
  };

  // Handle update entry
  const handleUpdateEntry = async () => {
    if (!entryToEdit) return;
    
    setIsSubmitting(true);
    
    try {
      await apiRequest('PUT', `/api/watchlist/${entryToEdit.id}`, {
        watchedDate: editWatchedDate || null,
        notes: editNotes || null,
      });
      
      toast({
        title: "Entry updated",
        description: `${entryToEdit.movie.title} has been updated in your watchlist`,
      });
      
      // Invalidate the watchlist cache
      if (currentUser) {
        queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      }
      
      // Close the modal
      setIsEditModalOpen(false);
    } catch (error) {
      console.error('Error updating watchlist entry:', error);
      toast({
        title: "Failed to update entry",
        description: "There was an error updating your watchlist entry",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle delete entry
  const handleDeleteEntry = (entryId: number) => {
    setEntryToDelete(entryId);
    setIsDeleteDialogOpen(true);
  };

  // Confirm delete
  const confirmDelete = async () => {
    if (!entryToDelete) return;
    
    try {
      await apiRequest('DELETE', `/api/watchlist/${entryToDelete}`, undefined);
      
      toast({
        title: "Entry removed",
        description: "The item has been removed from your watchlist",
      });
      
      // Invalidate the watchlist cache
      if (currentUser) {
        queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      }
    } catch (error) {
      console.error('Error deleting watchlist entry:', error);
      toast({
        title: "Failed to remove entry",
        description: "There was an error removing the item from your watchlist",
        variant: "destructive",
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setEntryToDelete(null);
    }
  };

  // Extract unique genres from watchlist
  const extractGenres = () => {
    if (!watchlist) return [];
    
    const genreSet = new Set<string>();
    watchlist.forEach(entry => {
      const genres = entry.movie.genres || '';
      genres.split(',').forEach(genre => {
        if (genre.trim()) genreSet.add(genre.trim());
      });
    });
    
    return Array.from(genreSet).sort();
  };

  // Get watchlist stats
  const getWatchlistStats = () => {
    if (!watchlist) return { total: 0, movies: 0, tv: 0 };
    
    const movies = watchlist.filter(entry => entry.movie.mediaType === 'movie').length;
    const tv = watchlist.filter(entry => entry.movie.mediaType === 'tv').length;
    
    return {
      total: watchlist.length,
      movies,
      tv
    };
  };

  const genres = extractGenres();
  const stats = getWatchlistStats();

  const mediaTypeFilters = [
    { value: 'all', label: 'All', icon: Menu },
    { value: 'movie', label: 'Movies', icon: Film },
    { value: 'tv', label: 'TV Shows', icon: Tv2 },
  ];

  // Add media type entries to TMDBMovie from watchlist entry
  const createTMDBMovieFromEntry = (entry: WatchlistEntryWithMovie): TMDBMovie => {
    return {
      id: entry.movie.tmdbId,
      title: entry.movie.title,
      overview: entry.movie.overview || '',
      poster_path: entry.movie.posterPath || '',
      backdrop_path: entry.movie.backdropPath || '',
      release_date: entry.movie.releaseDate || '',
      vote_average: parseFloat(entry.movie.voteAverage || '0'),
      genre_ids: [],
      media_type: entry.movie.mediaType
    };
  };

  if (!currentUser) {
    return (
      <Alert className="bg-[#292929] text-white border-yellow-600">
        <AlertCircle className="h-4 w-4 text-yellow-600" />
        <AlertDescription>
          Please select a user to view the watchlist
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="flex flex-col mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3">
          <h2 className="text-xl font-bold mb-2 md:mb-0 font-heading">
            My Watchlist 
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({stats.total} {stats.total === 1 ? 'item' : 'items'})
            </span>
          </h2>
          
          {/* Media Type Stats */}
          <div className="flex space-x-2">
            <Badge variant="outline" className="flex items-center">
              <Film className="h-3 w-3 mr-1" />
              {stats.movies} {stats.movies === 1 ? 'Movie' : 'Movies'}
            </Badge>
            <Badge variant="outline" className="flex items-center">
              <Tv2 className="h-3 w-3 mr-1" />
              {stats.tv} {stats.tv === 1 ? 'TV Show' : 'TV Shows'}
            </Badge>
          </div>
        </div>
        
        {/* Media Type Filter Tabs (Desktop) */}
        <div className="hidden md:flex justify-center mb-4">
          <div className="inline-flex items-center rounded-lg bg-[#292929] p-1">
            {mediaTypeFilters.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.value}
                  className={`flex items-center px-3 py-2 text-sm rounded-md transition ${
                    mediaTypeFilter === filter.value 
                      ? 'bg-[#E50914] text-white' 
                      : 'text-gray-300 hover:text-white'
                  }`}
                  onClick={() => setMediaTypeFilter(filter.value as MediaFilterType)}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Media Type Filter Dropdown (Mobile) */}
        <div className="md:hidden flex justify-center mb-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="bg-[#292929] border-gray-700">
                <span className="mr-2">
                  {mediaTypeFilters.find(f => f.value === mediaTypeFilter)?.label || 'Filter'}
                </span>
                {(() => {
                  const Icon = mediaTypeFilters.find(f => f.value === mediaTypeFilter)?.icon || Menu;
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
                      mediaTypeFilter === filter.value ? 'bg-[#E50914] text-white' : ''
                    }`}
                    onClick={() => setMediaTypeFilter(filter.value as MediaFilterType)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {filter.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        {/* Filter and Sort Controls */}
        <div className="flex flex-col sm:flex-row justify-center space-y-2 sm:space-y-0 sm:space-x-2">
          <Select value={selectedGenre} onValueChange={setSelectedGenre}>
            <SelectTrigger className="bg-[#292929] text-white border-gray-700 focus:ring-[#E50914]">
              <SelectValue placeholder="All Genres" />
            </SelectTrigger>
            <SelectContent className="bg-[#292929] text-white border-gray-700">
              <SelectItem value="all">All Genres</SelectItem>
              {genres.map((genre) => (
                <SelectItem key={genre} value={genre}>{genre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="bg-[#292929] text-white border-gray-700 focus:ring-[#E50914]">
              <SelectValue placeholder="Sort By" />
            </SelectTrigger>
            <SelectContent className="bg-[#292929] text-white border-gray-700">
              <SelectItem value="date_desc">Recently Watched</SelectItem>
              <SelectItem value="date_asc">Oldest First</SelectItem>
              <SelectItem value="title_asc">Title (A-Z)</SelectItem>
              <SelectItem value="title_desc">Title (Z-A)</SelectItem>
              <SelectItem value="rating_desc">Rating (High-Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Watchlist Entries */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="bg-[#292929] rounded-lg overflow-hidden flex">
              <Skeleton className="w-24 md:w-28 h-auto" />
              <div className="p-3 flex-grow">
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2 mb-4" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : watchlist && watchlist.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedWatchlist().map(entry => (
            <WatchlistEntry 
              key={entry.id} 
              entry={entry} 
              onEdit={handleEditEntry}
              onDelete={handleDeleteEntry}
              onShowDetails={handleShowDetails}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-10 text-gray-400">
          {mediaTypeFilter === 'all' 
            ? "Your watchlist is empty. Search for movies and TV shows to add them to your watchlist."
            : `Your ${mediaTypeFilter === 'movie' ? 'movie' : 'TV show'} watchlist is empty.`
          }
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#292929] text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Confirm Removal</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            Are you sure you want to remove this item from your watchlist?
          </div>
          <DialogFooter className="flex justify-end space-x-2">
            <Button 
              variant="ghost" 
              onClick={() => setIsDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDelete}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Entry Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => !isSubmitting && setIsEditModalOpen(open)}>
        <DialogContent className="bg-[#292929] text-white border-gray-700 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Watchlist Entry</DialogTitle>
          </DialogHeader>
          
          {entryToEdit && (
            <form onSubmit={(e) => { e.preventDefault(); handleUpdateEntry(); }}>
              <div className="mb-4">
                <Label htmlFor="edit-watch-date" className="text-sm font-medium mb-2">When did you watch it?</Label>
                <Input 
                  type="date" 
                  id="edit-watch-date" 
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
                  value={editWatchedDate}
                  onChange={(e) => setEditWatchedDate(e.target.value)}
                />
              </div>
              
              <div className="mb-6">
                <Label htmlFor="edit-watch-notes" className="text-sm font-medium mb-2">Notes (optional)</Label>
                <Textarea 
                  id="edit-watch-notes" 
                  rows={3} 
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
                  placeholder={`Add your thoughts about the ${entryToEdit.movie.mediaType === 'tv' ? 'show' : 'movie'}...`}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
              
              <DialogFooter className="flex justify-end space-x-2">
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-[#E50914] text-white hover:bg-red-700"
                  disabled={isSubmitting}
                >
                  Update Entry
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      {selectedEntry && (
        <DetailsModal 
          item={createTMDBMovieFromEntry(selectedEntry)}
          isOpen={isDetailsModalOpen}
          onClose={() => setIsDetailsModalOpen(false)}
          onAddToWatchlist={() => {
            toast({
              title: "Already in watchlist",
              description: "This item is already in your watchlist",
            });
          }}
        />
      )}
    </div>
  );
};

export default WatchlistPage;
