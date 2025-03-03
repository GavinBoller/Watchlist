import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUserContext } from '@/components/UserSelector';
import WatchlistEntry from '@/components/WatchlistEntry';
import { AddToWatchlistModal } from '@/components/AddToWatchlistModal';
import { TMDBMovie, WatchlistEntryWithMovie } from '@shared/schema';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const WatchlistPage = () => {
  const { currentUser } = useUserContext();
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<string>('date_desc');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<WatchlistEntryWithMovie | null>(null);
  const [editWatchedDate, setEditWatchedDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  // Fetch watchlist
  const { data: watchlist, isLoading } = useQuery({ 
    queryKey: currentUser ? [`/api/watchlist/${currentUser.id}`] : [],
    enabled: !!currentUser,
  });

  // Filter and sort watchlist
  const filteredAndSortedWatchlist = () => {
    if (!watchlist) return [];

    // First filter by genre if selected
    let filtered = watchlist;
    if (selectedGenre && selectedGenre !== 'all') {
      filtered = watchlist.filter(entry => 
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
        description: "The movie has been removed from your watchlist",
      });
      
      // Invalidate the watchlist cache
      if (currentUser) {
        queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      }
    } catch (error) {
      console.error('Error deleting watchlist entry:', error);
      toast({
        title: "Failed to remove entry",
        description: "There was an error removing the movie from your watchlist",
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
      if (entry.movie.genres) {
        entry.movie.genres.split(',').forEach(genre => {
          if (genre.trim()) genreSet.add(genre.trim());
        });
      }
    });
    
    return Array.from(genreSet).sort();
  };

  const genres = extractGenres();

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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6">
        <h2 className="text-xl font-bold mb-2 md:mb-0 font-heading">My Watchlist</h2>
        
        {/* Filter and Sort Controls */}
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
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
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-10 text-gray-400">
          Your watchlist is empty. Search for movies to add them to your watchlist.
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#292929] text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Confirm Removal</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            Are you sure you want to remove this movie from your watchlist?
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
                  placeholder="Add your thoughts about the movie..."
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
    </div>
  );
};

export default WatchlistPage;
