import { useState } from 'react';
import { TMDBMovie } from '@shared/schema';
import { useUserContext } from './UserSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { getImageUrl, getReleaseYear, getGenreNames } from '@/api/tmdb';
import { Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';

interface AddToWatchlistModalProps {
  movie: TMDBMovie | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AddToWatchlistModal = ({ movie, isOpen, onClose }: AddToWatchlistModalProps) => {
  const { currentUser } = useUserContext();
  const [watchedDate, setWatchedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  if (!movie) return null;

  const posterUrl = getImageUrl(movie.poster_path, 'w200');
  const year = getReleaseYear(movie.release_date);
  const genres = getGenreNames(movie.genre_ids);
  
  // Format vote average to one decimal place
  const voteAverage = movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) {
      toast({
        title: "No user selected",
        description: "Please select a user before adding to watchlist",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      await apiRequest('POST', '/api/watchlist', {
        userId: currentUser.id,
        tmdbMovie: movie,
        watchedDate: watchedDate || null,
        notes: notes || null,
      });
      
      toast({
        title: "Movie added",
        description: `${movie.title} has been added to your watchlist`,
      });
      
      // Invalidate the watchlist cache
      queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      
      // Close the modal and reset form
      handleClose();
    } catch (error) {
      console.error('Error adding movie to watchlist:', error);
      toast({
        title: "Failed to add movie",
        description: "There was an error adding the movie to your watchlist",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setWatchedDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-[#292929] text-white border-gray-700 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Watchlist</DialogTitle>
        </DialogHeader>
        
        <div className="flex mb-6">
          <img 
            src={posterUrl || 'https://via.placeholder.com/100x150?text=No+Image'}
            alt={movie.title} 
            className="w-24 rounded"
          />
          <div className="ml-4">
            <h4 className="font-bold text-lg">{movie.title}</h4>
            <p className="text-sm text-gray-300">{year}{genres ? ` • ${genres}` : ''}</p>
            <div className="flex items-center mt-1">
              <span className="text-[#F5C518] font-bold text-sm">{voteAverage}</span>
              <div className="ml-1">
                <Star className="h-4 w-4 text-[#F5C518] fill-current" />
              </div>
            </div>
          </div>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="watch-date" className="text-sm font-medium mb-2">When did you watch it?</Label>
            <Input 
              type="date" 
              id="watch-date" 
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
              value={watchedDate}
              onChange={(e) => setWatchedDate(e.target.value)}
            />
          </div>
          
          <div className="mb-6">
            <Label htmlFor="watch-notes" className="text-sm font-medium mb-2">Notes (optional)</Label>
            <Textarea 
              id="watch-notes" 
              rows={3} 
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
              placeholder="Add your thoughts about the movie..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          
          <DialogFooter className="flex justify-end space-x-2">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={handleClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              className="bg-[#E50914] text-white hover:bg-red-700"
              disabled={isSubmitting}
            >
              Add to Watchlist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
