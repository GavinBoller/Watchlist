import { useState } from 'react';
import { TMDBMovie } from '@shared/schema';
import { useUserContext } from './UserSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { getImageUrl, getTitle, getMediaType, getReleaseDate, formatMovieDisplay } from '@/api/tmdb';
import { Star, Film, Tv2, X, CalendarIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';

interface AddToWatchlistModalProps {
  item: TMDBMovie | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AddToWatchlistModal = ({ item, isOpen, onClose }: AddToWatchlistModalProps) => {
  const { currentUser } = useUserContext();
  const [watchedDate, setWatchedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();

  if (!item) return null;

  const posterUrl = getImageUrl(item.poster_path, 'w200');
  const title = getTitle(item);
  const mediaType = getMediaType(item);
  const displayInfo = formatMovieDisplay(item);
  
  // Format vote average to one decimal place
  const voteAverage = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';
  
  // Media type icon and label
  const MediaTypeIcon = mediaType === 'tv' ? Tv2 : Film;
  const mediaTypeLabel = mediaType === 'tv' ? 'TV Show' : 'Movie';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentUser) {
      toast({
        title: "No user selected",
        description: "Please select a user before adding to your watched list",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    try {
      await apiRequest('POST', '/api/watchlist', {
        userId: currentUser.id,
        tmdbMovie: item,
        watchedDate: watchedDate || null,
        notes: notes || null,
      });
      
      toast({
        title: `${mediaTypeLabel} added`,
        description: `${title} has been added to your watched list`,
      });
      
      // Invalidate the watched list cache
      queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      
      // Close the modal and reset form
      handleClose();
    } catch (error) {
      console.error('Error adding to watched list:', error);
      toast({
        title: "Failed to add to watched list",
        description: "There was an error adding the item to your watched list",
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
      <DialogContent className={`bg-[#292929] text-white border-gray-700 ${isMobile ? 'max-w-[95vw] p-4' : 'sm:max-w-md'}`}>
        {/* Custom close button for better mobile visibility */}
        <DialogClose className="absolute right-4 top-4 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-600 p-1">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
        
        <DialogHeader>
          <DialogTitle className="text-lg font-bold pr-6">Add to Watched</DialogTitle>
          <DialogDescription className="text-gray-400">
            Add this {mediaTypeLabel.toLowerCase()} to your watched list
          </DialogDescription>
        </DialogHeader>
        
        <div>
          {/* Movie/Show info section - flex column on mobile */}
          <div className={`${isMobile ? 'flex flex-col' : 'flex'} mb-4`}>
            <div className={`relative ${isMobile ? 'mx-auto mb-3' : ''}`}>
              <img 
                src={posterUrl || 'https://via.placeholder.com/100x150?text=No+Image'}
                alt={title} 
                className={`rounded ${isMobile ? 'h-36' : 'w-24'}`}
              />
              <div className={`absolute top-2 right-2 ${mediaType === 'tv' ? 'bg-blue-600' : 'bg-[#E50914]'} text-white text-xs font-bold py-1 px-2 rounded-full`}>
                {mediaType === 'tv' ? 'TV' : 'Movie'}
              </div>
            </div>
            <div className={isMobile ? 'text-center' : 'ml-4'}>
              <h4 className="font-bold text-lg">{title}</h4>
              <div className={`flex items-center text-sm text-gray-300 ${isMobile ? 'justify-center' : ''}`}>
                <MediaTypeIcon className="h-3 w-3 mr-1" />
                <span>{displayInfo}</span>
              </div>
              <div className={`flex items-center mt-1 ${isMobile ? 'justify-center' : ''}`}>
                <span className="text-[#F5C518] font-bold text-sm">{voteAverage}</span>
                <div className="ml-1">
                  <Star className="h-4 w-4 text-[#F5C518] fill-current" />
                </div>
              </div>
            </div>
          </div>
          
          {/* Overview section - reduced size on mobile */}
          <div className="mb-4 bg-gray-800 rounded-lg p-3">
            <h5 className="text-sm font-medium mb-1">Overview</h5>
            <p className={`text-xs text-gray-300 ${isMobile ? 'max-h-16' : 'max-h-20'} overflow-y-auto`}>
              {item.overview || "No overview available."}
            </p>
          </div>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <Label htmlFor="watch-date" className="text-sm font-medium block mb-2">When did you watch it?</Label>
            <div className="relative">
              <CalendarIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input 
                type="date" 
                id="watch-date" 
                className={`w-full bg-gray-700 text-white rounded-lg pl-10 pr-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600 ${isMobile ? 'text-base' : ''}`}
                value={watchedDate}
                onChange={(e) => setWatchedDate(e.target.value)}
              />
            </div>
          </div>
          
          <div className="mb-6">
            <Label htmlFor="watch-notes" className="text-sm font-medium block mb-2">Notes (optional)</Label>
            <Textarea 
              id="watch-notes" 
              rows={3} 
              className={`w-full bg-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600 ${isMobile ? 'text-base' : ''}`}
              placeholder={`Add your thoughts about the ${mediaType === 'tv' ? 'show' : 'movie'}...`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          
          <DialogFooter className={`${isMobile ? 'flex-col space-y-2' : 'flex justify-end space-x-2'}`}>
            {isMobile ? (
              <>
                <Button 
                  type="submit" 
                  className="bg-[#E50914] text-white hover:bg-red-700 w-full py-3 text-base font-medium"
                  disabled={isSubmitting}
                >
                  Add to Watched
                </Button>
                <Button 
                  type="button" 
                  variant="ghost" 
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="w-full py-3 text-base"
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
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
                  Add to Watched
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
