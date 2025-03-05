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
import { handleSessionExpiration, isSessionError } from '@/lib/session-utils';

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
    
    // First, verify and refresh the session to ensure it's valid before continuing
    try {
      console.log("Refreshing session before watchlist operation");
      const sessionResponse = await fetch("/api/auth/refresh-session", {
        credentials: "include",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        }
      });
      
      if (!sessionResponse.ok) {
        console.error("Session refresh failed with status:", sessionResponse.status);
        
        if (sessionResponse.status === 401) {
          // If session is invalid, show toast and redirect to login
          toast({
            title: "Session expired",
            description: "Your session has expired. Please login again to continue.",
            variant: "destructive",
          });
          
          // Update auth state
          queryClient.setQueryData(["/api/user"], null);
          
          // Close modal and redirect
          onClose();
          setTimeout(() => {
            window.location.href = '/auth';
          }, 1500);
          
          setIsSubmitting(false);
          return;
        }
        
        // For other errors, try to proceed anyway
        console.warn("Session refresh failed but proceeding with watchlist operation");
      } else {
        // Session refreshed successfully
        const refreshData = await sessionResponse.json();
        console.log("Session refreshed successfully:", refreshData);
      }
    } catch (sessionError) {
      console.error("Error during session refresh:", sessionError);
      // Continue despite error - the main request will handle auth issues if they exist
    }
    
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
    
    // Use multiple retries with our improved API client
    const apiOptions = {
      retries: 3,
      retryDelay: 800,
      timeout: 20000 // Longer timeout for this important operation
    };

    try {
      console.log("Submitting watchlist data:", JSON.stringify(watchlistData, null, 2));
      
      // Enhanced pre-submission session verification with multiple checks
      try {
        console.log("Performing comprehensive session verification before watchlist operation");
        
        // Try multiple endpoints to verify authentication status
        // This creates redundancy in case one endpoint has issues
        const verifications = [];
        
        // First verification using /api/session (primary)
        try {
          const sessionCheck = await fetch("/api/session", { 
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
          
          if (sessionCheck.ok) {
            const sessionData = await sessionCheck.json();
            console.log("Primary session verification result:", sessionData);
            verifications.push({
              source: "session-api",
              authenticated: sessionData.authenticated,
              data: sessionData
            });
          } else {
            console.warn("Primary session check failed with status:", sessionCheck.status);
            verifications.push({
              source: "session-api",
              authenticated: false,
              error: `Status ${sessionCheck.status}`
            });
          }
        } catch (error) {
          console.error("Primary session check error:", error);
          verifications.push({
            source: "session-api",
            authenticated: false,
            error: String(error)
          });
        }
        
        // Second verification using /api/user (backup)
        try {
          const userCheck = await fetch("/api/user", { 
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            }
          });
          
          if (userCheck.status === 200) {
            const userData = await userCheck.json();
            console.log("Secondary user verification succeeded:", !!userData);
            verifications.push({
              source: "user-api",
              authenticated: true,
              data: userData
            });
          } else if (userCheck.status === 401) {
            console.warn("Secondary user verification indicates not authenticated");
            verifications.push({
              source: "user-api",
              authenticated: false,
              error: "Unauthorized"
            });
          } else {
            console.warn("Secondary user check failed with status:", userCheck.status);
            verifications.push({
              source: "user-api",
              authenticated: false,
              error: `Status ${userCheck.status}`
            });
          }
        } catch (error) {
          console.error("Secondary user check error:", error);
          verifications.push({
            source: "user-api",
            authenticated: false,
            error: String(error)
          });
        }
        
        console.log("Session verification results:", verifications);
        
        // Determine authentication status from all verification attempts
        const authenticated = verifications.some(v => v.authenticated);
        
        if (!authenticated) {
          console.error("User not authenticated when trying to add to watchlist");
          throw new Error("Comprehensive verification confirms not authenticated");
        } else {
          console.log("Pre-submission authentication verified successfully");
        }
      } catch (sessionError) {
        console.error("Session verification error:", sessionError);
        toast({
          title: "Authentication error",
          description: "Please login again to add items to your watchlist",
          variant: "destructive",
        });
        
        // Invalid the auth queries to ensure fresh data
        queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        
        // Force redirect to auth page with a short delay to allow toast to be seen
        setTimeout(() => {
          window.location.href = '/auth';
        }, 1500);
        
        setIsSubmitting(false);
        onClose();
        return;
      }
      
      // Try with max retries and cross-browser compatibility improvements
      const res = await apiRequest('POST', '/api/watchlist', watchlistData, apiOptions);
      
      // Handle successful response
      const contentType = res.headers.get('content-type');
      let data: any = null;
      
      // Make sure we can parse the response
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await res.json();
        } catch (parseError) {
          console.error('Error parsing watchlist response:', parseError);
        }
      }
      
      // Create appropriate status labels for the toast
      const statusLabel = status === 'to_watch' 
        ? 'plan to watch list' 
        : status === 'watching' 
          ? 'currently watching list'
          : 'watched list';
      
      // Check if it was already in watchlist
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
      // Use array format for better cache invalidation
      queryClient.invalidateQueries({ queryKey: ['/api/watchlist', currentUser.id] });
      queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
      
      // Also refresh user data to ensure session is still valid
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      
      // Close the modal and reset form
      handleClose();
    } catch (error: any) {
      console.error('Error adding to watchlist:', error);
      
      // Get response data where available for better error messages
      const errorData = error.data || {};
      console.log('Error details:', errorData);
      
      // Check for different error types and provide specific messages
      if (error.status === 409 || (errorData?.message === "Already in watchlist")) {
        toast({
          title: "Already Added",
          description: errorData?.details || `You've already added "${title}" to your list`,
          variant: "default",
        });
        // Still consider this a success since the item is in the watchlist
        handleClose();
      } else if (error.status === 400) {
        // Handle validation errors
        let errorMsg = "There was a problem with the data submitted";
        if (errorData?.errors) {
          errorMsg = Object.values(errorData.errors)
            .map((e: any) => e.message || e)
            .join(", ");
        } else if (errorData?.details) {
          errorMsg = errorData.details;
        }
        
        toast({
          title: "Invalid data",
          description: errorMsg,
          variant: "destructive",
        });
      } else if (error.status === 401 || isSessionError(error)) {
        // Use our centralized session expiration handler
        const errorCode = errorData?.code;
        const errorMessage = errorData?.message || "Please log in again to add items to your watchlist";
        
        console.log('Authentication error detected:', errorCode, errorMessage);
        
        // Let the utility handle all aspects of session expiration
        await handleSessionExpiration(errorCode, errorMessage);
      } else if (error.status === 404) {
        // Handle user not found errors with specific message
        if (errorData?.message?.includes("User not found")) {
          toast({
            title: "User not found",
            description: errorData?.details || "The selected user account could not be found. Please try selecting a different user.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Not found",
            description: errorData?.message || "The requested resource was not found",
            variant: "destructive",
          });
        }
      } else if (error.isHtmlResponse) {
        // Special case for HTML responses (typically from error pages)
        toast({
          title: "Server error",
          description: "The server returned an unexpected response. Please try again later.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Failed to add item",
          description: error.message || errorData?.message || "There was an error adding the item to your list",
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
