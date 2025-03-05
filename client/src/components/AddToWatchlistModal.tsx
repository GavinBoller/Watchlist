import { useState } from 'react';
import { TMDBMovie } from '@shared/schema';
import { useUserContext } from './UserSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { getImageUrl, getTitle, getMediaType, getReleaseDate, formatMovieDisplay } from '@/api/tmdb';
import { Star, Film, Tv2, X, CalendarIcon, Clock, PlayCircle, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface AddToWatchlistModalProps {
  item: TMDBMovie | null;
  isOpen: boolean;
  onClose: () => void;
}

export const AddToWatchlistModal = ({ item, isOpen, onClose }: AddToWatchlistModalProps) => {
  const { currentUser } = useUserContext();
  const [watchedDate, setWatchedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState<string>('');
  const [status, setStatus] = useState<string>('watched');
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
        description: "Please select a user first",
        variant: "destructive",
      });
      return;
    }

    // Validate watchlist entry data before submission
    if (status === 'watched' && !watchedDate) {
      toast({
        title: "Missing watched date",
        description: "Please select a date when you watched this content",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    
    // Prepare watchlist entry data with proper validation
    const watchlistData = {
      userId: currentUser.id,
      tmdbMovie: {
        ...item,
        // Ensure required fields have valid values with fallbacks
        id: item.id || 0,
        title: getTitle(item) || "Unknown Title",
        overview: item.overview || "",
        poster_path: item.poster_path || "",
        backdrop_path: item.backdrop_path || "",
        vote_average: item.vote_average || 0,
        genre_ids: item.genre_ids || [],
        media_type: item.media_type || (item.first_air_date ? "tv" : "movie"),
      },
      watchedDate: status === 'watched' ? watchedDate || null : null,
      notes: notes || null,
      status: status,
    };
    
    try {
      console.log("Submitting watchlist data:", JSON.stringify(watchlistData, null, 2));
      
      const res = await apiRequest('POST', '/api/watchlist', watchlistData);
      const data = await res.json().catch(() => null);
      
      const statusLabel = status === 'to_watch' 
        ? 'plan to watch list' 
        : status === 'watching' 
          ? 'currently watching list'
          : 'watched list';
      
      if (data?.message === "Already in watchlist") {
        toast({
          title: "Already Added",
          description: data?.details || `You've already added "${title}" to your list`,
          variant: "default",
        });
      } else {
        toast({
          title: `${mediaTypeLabel} added`,
          description: `${title} has been added to your ${statusLabel}`,
        });
      }
      
      // Invalidate the watchlist cache to refresh the UI
      queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      
      // Close the modal and reset form
      handleClose();
    } catch (error: any) {
      console.error('Error adding to watchlist:', error);
      
      // Check for different error types and provide specific messages
      if (error.status === 409) {
        toast({
          title: "Already Added",
          description: error.data?.details || `You've already added "${title}" to your list`,
          variant: "default",
        });
      } else if (error.status === 400) {
        // Handle validation errors
        let errorMsg = "There was a problem with the data submitted";
        if (error.data?.errors) {
          errorMsg = Object.values(error.data.errors)
            .map((e: any) => e.message || e)
            .join(", ");
        }
        
        toast({
          title: "Invalid data",
          description: errorMsg,
          variant: "destructive",
        });
      } else if (error.status === 401) {
        toast({
          title: "Authentication error",
          description: "Please log in again to add items to your watchlist",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to add item",
          description: error.message || "There was an error adding the item to your list",
          variant: "destructive",
        });
      }
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
      <DialogContent 
        className={`bg-[#292929] text-white border-gray-700 ${isMobile ? 'max-w-[95vw] p-4' : 'sm:max-w-md'}`}
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        {/* Custom close button for better mobile visibility */}
        <DialogClose className="absolute right-4 top-4 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-600 p-1">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
        
        <DialogHeader>
          <DialogTitle className="text-lg font-bold pr-6" id="dialog-title">
            {status === 'to_watch' 
              ? 'Add to Plan to Watch' 
              : status === 'watching' 
                ? 'Add to Currently Watching'
                : 'Add to Watched'}
          </DialogTitle>
          <DialogDescription className="text-gray-400" id="dialog-description">
            Add this {mediaTypeLabel.toLowerCase()} to your {
              status === 'to_watch' 
                ? 'plan to watch' 
                : status === 'watching' 
                  ? 'currently watching'
                  : 'watched'
            } list
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
            <Label className="text-sm font-medium block mb-2">Watch Status</Label>
            <RadioGroup 
              value={status} 
              onValueChange={setStatus}
              className="space-y-2"
            >
              <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                <RadioGroupItem value="to_watch" id="status-to-watch" />
                <Label htmlFor="status-to-watch" className="flex items-center gap-2 cursor-pointer">
                  <Clock className="h-4 w-4 text-blue-400" />
                  <div>
                    <div className="font-medium">Plan to Watch</div>
                    <div className="text-xs text-gray-400">Save for later</div>
                  </div>
                </Label>
              </div>
              
              <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                <RadioGroupItem value="watching" id="status-watching" />
                <Label htmlFor="status-watching" className="flex items-center gap-2 cursor-pointer">
                  <PlayCircle className="h-4 w-4 text-green-400" />
                  <div>
                    <div className="font-medium">Currently Watching</div>
                    <div className="text-xs text-gray-400">Started but not finished</div>
                  </div>
                </Label>
              </div>
              
              <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                <RadioGroupItem value="watched" id="status-watched" />
                <Label htmlFor="status-watched" className="flex items-center gap-2 cursor-pointer">
                  <CheckCircle className="h-4 w-4 text-[#E50914]" />
                  <div>
                    <div className="font-medium">Watched</div>
                    <div className="text-xs text-gray-400">Already completed</div>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>
          
          {status === 'watched' && (
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
          )}
          
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
                  {isSubmitting ? (
                    <div className="flex items-center justify-center">
                      <span className="mr-2">Adding</span>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    </div>
                  ) : (
                    status === 'to_watch' 
                      ? 'Add to Plan to Watch' 
                      : status === 'watching' 
                        ? 'Add to Currently Watching'
                        : 'Add to Watched'
                  )}
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
                  {isSubmitting ? (
                    <div className="flex items-center justify-center">
                      <span className="mr-2">Adding</span>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></span>
                    </div>
                  ) : (
                    status === 'to_watch' 
                      ? 'Add to Plan to Watch' 
                      : status === 'watching' 
                        ? 'Add to Currently Watching'
                        : 'Add to Watched'
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
