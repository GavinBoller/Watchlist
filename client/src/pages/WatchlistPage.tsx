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
import { AlertCircle, Film, Tv2, Menu, BadgePlus, Inbox } from 'lucide-react';
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
  const { data: watchlist, isLoading } = useQuery<WatchlistEntryWithMovie[]>({ 
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
        description: `${entryToEdit.movie.title} has been updated in your watched list`,
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
        description: "The item has been removed from your watched list",
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
          Please select a user to view your watched items
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      <div className="flex flex-col mb-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-3">
          <h2 className="text-xl font-bold mb-2 md:mb-0 font-heading">
            Watched
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

        {/* Media Type Filter - iOS-friendly segmented control (Mobile) */}
        <div className="md:hidden mb-4 px-3">
          <div className="grid grid-cols-3 gap-1 bg-[#292929] rounded-lg p-1 shadow-inner">
            {mediaTypeFilters.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.value}
                  className={`flex items-center justify-center px-2 py-2.5 rounded-md text-sm transition ${
                    mediaTypeFilter === filter.value 
                      ? 'bg-[#3d3d3d] text-white font-medium shadow-sm' 
                      : 'text-gray-300 hover:bg-[#3d3d3d]/50'
                  }`}
                  onClick={() => setMediaTypeFilter(filter.value as MediaFilterType)}
                >
                  <Icon className={`h-4 w-4 mr-1.5 ${mediaTypeFilter === filter.value ? 'text-[#E50914]' : ''}`} />
                  <span>{filter.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        
        {/* Filter and Sort Controls */}
        <div className="flex flex-col sm:flex-row justify-center space-y-2 sm:space-y-0 sm:space-x-2 px-3">
          <Select value={selectedGenre} onValueChange={setSelectedGenre}>
            <SelectTrigger className="bg-[#292929] text-white border-gray-700 focus:ring-[#E50914] h-10">
              <SelectValue placeholder="All Genres" />
            </SelectTrigger>
            <SelectContent className="bg-[#292929] text-white border-gray-700 max-h-[50vh]">
              <SelectItem value="all" className="py-2.5">All Genres</SelectItem>
              {genres.map((genre) => (
                <SelectItem key={genre} value={genre} className="py-2.5">{genre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Select value={sortOrder} onValueChange={setSortOrder}>
            <SelectTrigger className="bg-[#292929] text-white border-gray-700 focus:ring-[#E50914] h-10">
              <SelectValue placeholder="Sort By" />
            </SelectTrigger>
            <SelectContent className="bg-[#292929] text-white border-gray-700">
              <SelectItem value="date_desc" className="py-2.5">Recently Watched</SelectItem>
              <SelectItem value="date_asc" className="py-2.5">Oldest First</SelectItem>
              <SelectItem value="title_asc" className="py-2.5">Title (A-Z)</SelectItem>
              <SelectItem value="title_desc" className="py-2.5">Title (Z-A)</SelectItem>
              <SelectItem value="rating_desc" className="py-2.5">Rating (High-Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Watchlist Entries */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-3">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="bg-[#292929] rounded-lg overflow-hidden flex shadow">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-3">
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
        <div className="text-center py-10 px-5 mx-auto max-w-md">
          <div className="bg-[#292929]/50 rounded-xl p-6 shadow-md">
            <div className="text-gray-400 mb-4 flex justify-center">
              {mediaTypeFilter === 'all' ? (
                <Inbox className="h-12 w-12 opacity-50" />
              ) : mediaTypeFilter === 'movie' ? (
                <Film className="h-12 w-12 opacity-50" />
              ) : (
                <Tv2 className="h-12 w-12 opacity-50" />
              )}
            </div>
            <p className="text-gray-300 font-medium">
              {mediaTypeFilter === 'all' 
                ? "Your watched list is empty"
                : `No ${mediaTypeFilter === 'movie' ? 'movies' : 'TV shows'} in your list`
              }
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {mediaTypeFilter === 'all' 
                ? "Search for movies and TV shows to add what you've watched."
                : `Switch to the Search tab to add some ${mediaTypeFilter === 'movie' ? 'movies' : 'TV shows'}.`
              }
            </p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog - iOS optimized */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#292929] text-white border-gray-700 max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Confirm Removal</DialogTitle>
          </DialogHeader>
          <div className="py-4 text-center sm:text-left">
            <p className="text-gray-200">
              Are you sure you want to remove this item from your watched list?
            </p>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end mt-2">
            <Button 
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="w-full sm:w-auto py-2 h-12 sm:h-10 text-base sm:text-sm border-gray-600"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={confirmDelete}
              className="w-full sm:w-auto py-2 h-12 sm:h-10 text-base sm:text-sm"
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Entry Modal - iOS optimized */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => !isSubmitting && setIsEditModalOpen(open)}>
        <DialogContent className="bg-[#292929] text-white border-gray-700 sm:max-w-md max-h-[95vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Edit Watched Entry</DialogTitle>
            {entryToEdit && (
              <p className="text-sm text-gray-400 mt-1 line-clamp-1">{entryToEdit.movie.title}</p>
            )}
          </DialogHeader>
          
          {entryToEdit && (
            <form onSubmit={(e) => { e.preventDefault(); handleUpdateEntry(); }}>
              <div className="mb-4">
                <Label htmlFor="edit-watch-date" className="text-sm font-medium mb-2 block">When did you watch it?</Label>
                <Input 
                  type="date" 
                  id="edit-watch-date" 
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600 h-12"
                  value={editWatchedDate}
                  onChange={(e) => setEditWatchedDate(e.target.value)}
                />
              </div>
              
              <div className="mb-6">
                <Label htmlFor="edit-watch-notes" className="text-sm font-medium mb-2 block">Notes (optional)</Label>
                <Textarea 
                  id="edit-watch-notes" 
                  rows={4} 
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
                  placeholder={`Add your thoughts about the ${entryToEdit.movie.mediaType === 'tv' ? 'show' : 'movie'}...`}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
              
              <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsEditModalOpen(false)}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto py-2 h-12 sm:h-10 text-base sm:text-sm"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  className="bg-[#E50914] text-white hover:bg-red-700 w-full sm:w-auto py-2 h-12 sm:h-10 text-base sm:text-sm"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <div className="flex items-center justify-center">
                      <span className="mr-2">Updating</span>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    </div>
                  ) : "Update Entry"}
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
              title: "Already in watched list",
              description: "This item is already in your watched list",
            });
          }}
        />
      )}
    </div>
  );
};

export default WatchlistPage;
