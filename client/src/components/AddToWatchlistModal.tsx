import { useState, useEffect } from 'react';
import { TMDBMovie, Platform } from '@shared/schema';
import { useUserContext } from '@/lib/user-context';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [selectedPlatformId, setSelectedPlatformId] = useState<number | null>(null);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  
  const handleClose = () => {
    setWatchedDate(format(new Date(), 'yyyy-MM-dd'));
    setNotes('');
    setSelectedPlatformId(null);
    onClose();
  };
  
  // Fetch platforms when modal opens and user is available
  useEffect(() => {
    if (isOpen && currentUser?.id) {
      const fetchPlatforms = async () => {
        setLoadingPlatforms(true);
        try {
          const response = await apiRequest('GET', `/api/platforms/${currentUser.id}`);
          if (response.ok) {
            const data = await response.json();
            setPlatforms(data);
            
            // Set default platform if available
            const defaultPlatform = data.find((p: Platform) => p.isDefault === true);
            if (defaultPlatform) {
              setSelectedPlatformId(defaultPlatform.id);
            }
          }
        } catch (error) {
          console.error('Error fetching platforms:', error);
        } finally {
          setLoadingPlatforms(false);
        }
      };
      
      fetchPlatforms();
    }
  }, [isOpen, currentUser]);
  
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
    
    // Check if a user is selected before proceeding
    if (!currentUser || !currentUser.id) {
      console.error("User data is not available:", currentUser);
      toast({
        title: "Authentication Required",
        description: "Please login or select a user to add items to your watchlist.",
        variant: "destructive",
      });
      onClose();
      
      // Forcibly clear user data to make sure the app updates correctly
      queryClient.setQueryData(["/api/user"], null);
      
      // Redirect to auth page
      setTimeout(() => {
        window.location.href = '/auth';
      }, 1000);
      
      setIsSubmitting(false);
      return;
    }
    
    // Verify session before continuing
    try {
      const sessionResponse = await fetch("/api/refresh-session", {
        credentials: "include",
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate"
        }
      });
      
      if (!sessionResponse.ok) {
        console.error("Session refresh failed with status:", sessionResponse.status);
        
        // If session refresh fails, we need to re-authenticate
        toast({
          title: "Session expired",
          description: "Your session has expired. Please login again to continue.",
          variant: "destructive",
        });
        
        // Force logout
        queryClient.setQueryData(["/api/user"], null);
        
        // Redirect to auth
        onClose();
        setTimeout(() => {
          window.location.href = '/auth';
        }, 1000);
        
        setIsSubmitting(false);
        return;
      }
    } catch (error) {
      console.error("Error during session refresh:", error);
      // Continue despite error - the API request will handle auth issues
    }
    
    // Log user information for debugging
    console.log("Current user data:", currentUser);
    
    // Prepare watchlist entry data with proper validation
    const watchlistData = {
      userId: currentUser.id,
      // Add explicit tmdbId field to ensure it's properly recognized by the server
      tmdbId: item.id || 0,
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
      platformId: selectedPlatformId,
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
      
      // Execute a more robust auth check before continuing
      try {
        console.log('[WATCHLIST] Pre-checking authentication before adding to watchlist');
        
        // Try to get token with fallbacks for maximum reliability
        let token = localStorage.getItem('jwt_token');
        
        // If token is missing, try backup locations
        if (!token) {
          // Try backup in localStorage
          token = localStorage.getItem('movietracker_token_backup');
          
          // Try sessionStorage
          if (!token) {
            token = sessionStorage.getItem('jwt_token') || 
                  sessionStorage.getItem('movietracker_token_backup');
                  
            // Try to retrieve from cookie as last resort
            if (!token) {
              const cookies = document.cookie.split(';');
              for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name === 'jwt_token_backup' && value) {
                  token = value;
                  break;
                }
              }
            }
          }
        }
        
        // Create headers with JWT token if available
        const headers: Record<string, string> = {
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache"
        };
        
        // Include JWT token if available and valid format
        if (token && token.split('.').length === 3) {
          console.log('[WATCHLIST] Including JWT token in auth check request');
          headers['Authorization'] = `Bearer ${token}`;
          
          // Restore token to primary location
          localStorage.setItem('jwt_token', token);
        } else {
          console.warn('[WATCHLIST] No valid JWT token found for auth check');
        }
        
        // Always include user details in headers if available
        if (currentUser) {
          headers['X-User-ID'] = currentUser.id.toString();
          headers['X-Username'] = currentUser.username;
        }
        
        // First try with JWT endpoint
        const userCheck = await fetch("/api/jwt/user", { 
          credentials: "include",
          headers,
          cache: "no-store" // Ensure fresh check
        });
        
        if (!userCheck.ok) {
          console.warn(`JWT authentication check returned status: ${userCheck.status}`);
          
          // Try fallback to session-based auth
          const sessionCheck = await fetch("/api/user", {
            credentials: "include",
            headers: {
              "Cache-Control": "no-cache, no-store, must-revalidate",
              "Pragma": "no-cache"
            },
            cache: "no-store"
          });
          
          if (!sessionCheck.ok) {
            console.error("Authentication failed with both JWT and session methods");
            
            // Additional diagnostics - check if we can get token after a forced token refresh
            try {
              const refreshResponse = await fetch("/api/refresh-session", {
                method: "GET",
                credentials: "include",
                headers: {
                  "Cache-Control": "no-cache, no-store",
                  "Pragma": "no-cache"
                }
              });
              
              console.log(`Session refresh attempt status: ${refreshResponse.status}`);
            } catch (refreshError) {
              console.error("Error during emergency session refresh:", refreshError);
            }
            
            toast({
              title: "Authentication required",
              description: "Please login again to add items to your watchlist",
              variant: "destructive",
            });
            
            // Force a re-fetch of user data
            queryClient.invalidateQueries({ queryKey: ["/api/jwt/user"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user"] });
            queryClient.setQueryData(["/api/jwt/user"], null);
            queryClient.setQueryData(["/api/user"], null);
            
            // Clear any logout flags that might be blocking authentication
            localStorage.removeItem('just_logged_out');
            sessionStorage.removeItem('just_logged_out');
            if (typeof window !== 'undefined') {
              window.__loggedOut = false;
            }
            
            // Redirect to auth page after showing toast
            setTimeout(() => {
              window.location.href = '/auth';
            }, 1000);
            
            setIsSubmitting(false);
            onClose();
            return;
          }
        }
        
        console.log('[WATCHLIST] Authentication check passed, proceeding with request');
      } catch (error) {
        console.error("Auth check error:", error);
        // Continue despite error - the main request will handle auth issues
      }
      
      // Add backup user information and critical headers to help with recovery
      const headers: Record<string, string> = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      };
      
      // Get JWT token with fallbacks for reliability
      let token = localStorage.getItem('jwt_token');
      
      // If token is missing, try backup locations
      if (!token) {
        // Try backup in localStorage
        token = localStorage.getItem('movietracker_token_backup');
        
        // Try sessionStorage
        if (!token) {
          token = sessionStorage.getItem('jwt_token') || 
                sessionStorage.getItem('movietracker_token_backup');
                
          // Try to retrieve from cookie as last resort
          if (!token) {
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
              const [name, value] = cookie.trim().split('=');
              if (name === 'jwt_token_backup' && value) {
                token = value;
                break;
              }
            }
          }
        }
      }
      
      if (token) {
        console.log('[WATCHLIST] Adding JWT token to request directly');
        // Double check token format
        if (token.split('.').length === 3) {
          headers['Authorization'] = `Bearer ${token}`;
          
          // Restore token to primary location
          localStorage.setItem('jwt_token', token);
        } else {
          console.warn('[WATCHLIST] Retrieved token has invalid format');
        }
      } else {
        console.warn('[WATCHLIST] No JWT token found in any storage location');
      }
      
      // Add backup user information to help server recovery scenarios
      if (currentUser) {
        console.log(`Adding backup user information for reliability: ID=${currentUser.id}, Username=${currentUser.username}`);
        headers['X-User-ID'] = currentUser.id.toString();
        headers['X-Username'] = currentUser.username;
        headers['X-Request-Timestamp'] = Date.now().toString();
        
        // Also store backup in session storage for client-side recovery
        try {
          sessionStorage.setItem('auth_backup', JSON.stringify({
            userId: currentUser.id,
            username: currentUser.username,
            timestamp: Date.now()
          }));
          
          // Also store in window object for immediate memory access
          (window as any).__authBackup = {
            userId: currentUser.id,
            username: currentUser.username,
            timestamp: Date.now()
          };
        } catch (e) {
          console.error('Error creating auth backup:', e);
        }
      }
      
      // Try with max retries and cross-browser compatibility improvements
      console.log('[WATCHLIST] Sending request with headers:', headers);
      const res = await apiRequest('POST', '/api/watchlist', watchlistData, { 
        ...apiOptions,
        headers
      });
      
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
        ? 'to watch list' 
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
        // Find platform name if a platform is selected
        const selectedPlatform = selectedPlatformId
          ? platforms.find(p => p.id === selectedPlatformId)?.name
          : null;
        
        const platformText = selectedPlatform 
          ? ` on ${selectedPlatform}`
          : '';
            
        toast({
          title: `${mediaTypeLabel} added`,
          description: `${title} has been added to your ${statusLabel}${platformText}`,
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
      } else {
        // Use our enhanced error detection for better error messages
        const errorInfo = isSessionError(error);
        
        if (errorInfo.isAuthError) {
          // Use our centralized session expiration handler for auth errors
          console.log('Authentication error detected:', errorInfo);
          const errorMessage = errorData?.message || "Please log in again to add items to your watchlist";
          
          // Handle session expiration with the central handler
          handleSessionExpiration(errorInfo.errorType, errorMessage);
        } else if (errorInfo.isNetworkError) {
          console.log('Network error detected:', errorInfo);
          // Show a network-specific error message
          toast({
            title: "Connection error",
            description: "Please check your internet connection and try again",
            variant: "destructive",
          });
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
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent 
        className={`bg-[#292929] text-white border-gray-700 ${isMobile ? 'p-4 pb-6' : 'sm:max-w-md'}`}
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
              ? 'Add to To Watch' 
              : status === 'watching' 
                ? 'Add to Currently Watching'
                : 'Add to Watched'}
          </DialogTitle>
          <DialogDescription className="text-gray-400" id="dialog-description">
            Add this {mediaTypeLabel.toLowerCase()} to your {
              status === 'to_watch' 
                ? 'to watch' 
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
                    <div className="font-medium">To Watch</div>
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
          
          <div className="mt-4">
            <Label htmlFor="platform" className="text-gray-300 mb-1 block">Platform</Label>
            <Select 
              value={selectedPlatformId ? selectedPlatformId.toString() : 'none'} 
              onValueChange={(value) => setSelectedPlatformId(value !== 'none' ? parseInt(value) : null)}
            >
              <SelectTrigger className="w-full bg-gray-800 border-gray-700">
                <SelectValue placeholder="Select platform (optional)" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                <div className="p-1 text-sm text-gray-400 border-b border-gray-700">
                  {loadingPlatforms ? 'Loading platforms...' : platforms.length === 0 ? 'No platforms added yet' : 'Your platforms'}
                </div>
                <SelectItem value="none">No platform</SelectItem>
                {platforms
                  .slice() // Create a copy to avoid mutating the original array
                  .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically by name
                  .map((platform) => (
                    <SelectItem key={platform.id} value={platform.id.toString()}>
                      {platform.name} {platform.isDefault && '(Default)'}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
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
                      ? 'Add to To Watch' 
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
                      ? 'Add to To Watch' 
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
