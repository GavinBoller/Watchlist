import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUserContext } from '@/lib/user-context';
import WatchlistEntry from '@/components/WatchlistEntry';
import { DetailsModal } from '@/components/DetailsModal';
import { PlatformManagementModal } from '@/components/PlatformManagementModal';
import { TMDBMovie, WatchlistEntryWithMovie, Platform } from '@shared/schema';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiRequest } from '@/lib/queryClient';
import { queryClient } from '@/lib/queryClient';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, Clock, Film, Tv2, Menu, BadgePlus, Inbox, PlayCircle, Search, X, RefreshCw, Monitor, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type MediaFilterType = 'all' | 'movie' | 'tv';
type StatusFilterType = 'all' | 'to_watch' | 'watching' | 'watched';

const WatchlistPage = () => {
  const { currentUser } = useUserContext();
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaFilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('all');
  const [sortOrder, setSortOrder] = useState<string>('date_desc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<number | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [entryToEdit, setEntryToEdit] = useState<WatchlistEntryWithMovie | null>(null);
  const [editWatchedDate, setEditWatchedDate] = useState<string>('');
  const [editNotes, setEditNotes] = useState<string>('');
  const [editStatus, setEditStatus] = useState<string>('watched');
  const [editPlatformId, setEditPlatformId] = useState<number | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);
  const [isPlatformModalOpen, setIsPlatformModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<WatchlistEntryWithMovie | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  
  // Keyboard shortcut for search (desktop only)
  useEffect(() => {
    // Skip keyboard shortcuts on mobile devices
    if (typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
      return;
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F or Cmd+F (Mac) to focus search input
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
      
      // Escape key to clear search
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current && searchQuery) {
        e.preventDefault();
        setSearchQuery('');
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery]);

  // Mobile browser detection
  const isMobileSafari = typeof navigator !== 'undefined' && 
    /iPhone|iPad|iPod/i.test(navigator.userAgent) && 
    /AppleWebKit/i.test(navigator.userAgent) &&
    !(/Chrome/i.test(navigator.userAgent));
  
  // Mobile Safari specific auto-refresh state
  const [hasAutoRefreshed, setHasAutoRefreshed] = useState(false);
  
  // Effect for mobile Safari auto-refresh
  // Listen for custom event to open platform management modal
  useEffect(() => {
    const handleOpenPlatformManagement = () => {
      console.log('[PLATFORM] Received openPlatformManagement event');
      setIsPlatformModalOpen(true);
    };
    
    window.addEventListener('openPlatformManagement', handleOpenPlatformManagement);
    
    return () => {
      window.removeEventListener('openPlatformManagement', handleOpenPlatformManagement);
    };
  }, []);
  
  // Load platforms data when component mounts
  useEffect(() => {
    if (currentUser) {
      fetchPlatforms(currentUser.id);
    }
  }, [currentUser]);

  useEffect(() => {
    if (isMobileSafari && currentUser && !hasAutoRefreshed) {
      // Brief delay to let page fully load before refresh
      const timer = setTimeout(() => {
        // Only auto-refresh once per session
        setHasAutoRefreshed(true);
        
        // For Safari on iOS, we need to refresh token storage
        try {
          const token = localStorage.getItem('jwt_token');
          if (token) {
            // Save to sessionStorage as a backup
            sessionStorage.setItem('jwt_token', token);
            sessionStorage.setItem('movietracker_token_backup', token);
            
            // Also create a cookie backup
            document.cookie = `jwt_token_backup=${token}; path=/; max-age=3600; SameSite=Strict`;
            
            console.log("[MOBILE] Created token backups for iOS Safari compatibility");
          }
        } catch (e) {
          console.error("[MOBILE] Error creating token backups:", e);
        }
        
        // Force a refresh of the watchlist data
        queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
        console.log("[MOBILE] Triggering auto-refresh for iOS Safari compatibility");
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [currentUser, isMobileSafari, hasAutoRefreshed]);
  
  // Fetch watchlist with enhanced error recovery for production
  const { data: watchlist, isLoading, refetch } = useQuery<WatchlistEntryWithMovie[]>({ 
    queryKey: currentUser ? [`/api/watchlist/${currentUser.id}`] : [],
    enabled: !!currentUser,
    queryFn: async ({ queryKey }) => {
      if (!currentUser) return [];
      
      try {
        console.log(`Fetching watchlist for user ${currentUser.username} (ID: ${currentUser.id})`);
        
        // Add redundant auth headers to help with "user not found" issues
        // Get JWT token with multiple fallbacks for reliability
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
        
        const headers: Record<string, string> = {
          'X-User-ID': currentUser.id.toString(),
          'X-Username': currentUser.username,
          'X-Request-Timestamp': Date.now().toString(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        };
        
        // Add JWT token if available and valid format
        if (token && token.split('.').length === 3) {
          console.log('[WATCHLIST] Including JWT token in watchlist fetch request');
          headers['Authorization'] = `Bearer ${token}`;
          
          // Restore token to primary location
          localStorage.setItem('jwt_token', token);
        } else {
          console.warn('[WATCHLIST] No valid JWT token found for watchlist fetch');
        }
        
        const res = await fetch(`/api/watchlist/${currentUser.id}`, {
          headers,
          cache: 'no-store',
          credentials: 'include' // Include cookies for session-based auth as fallback
        });
        
        // Check for recovery headers
        const recoveryMethod = res.headers.get('X-Recovery-Method');
        const recoveryStatus = res.headers.get('X-Recovery-Status');
        
        if (recoveryMethod) {
          console.log(`Server used recovery method: ${recoveryMethod}`);
        }
        
        if (recoveryStatus === 'failed') {
          console.warn('Server recovery failed, using client-side backup if available');
        }
        
        if (!res.ok) {
          throw new Error(`Failed to fetch watchlist: ${res.status}`);
        }
        
        // Process the response
        const entries = await res.json();
        
        // Create a backup for future recovery
        if (entries && Array.isArray(entries) && entries.length > 0) {
          console.log(`Backing up ${entries.length} watchlist entries locally`);
          try {
            // Store in session storage for this tab
            sessionStorage.setItem('watchlist_backup', JSON.stringify({
              userId: currentUser.id,
              username: currentUser.username,
              timestamp: Date.now(),
              entries: entries
            }));
            
            // Also store in window object for immediate memory access
            (window as any).__watchlistBackup = {
              userId: currentUser.id,
              entries: entries,
              timestamp: Date.now()
            };
          } catch (e) {
            console.error('Error backing up watchlist data:', e);
          }
        }
        
        return entries;
      } catch (error) {
        console.error('Error fetching watchlist:', error);
        
        // Try to recover from backup if available
        try {
          // Check window object first (fastest)
          if ((window as any).__watchlistBackup && 
              (window as any).__watchlistBackup.userId === currentUser.id) {
            console.log('Using in-memory watchlist backup');
            return (window as any).__watchlistBackup.entries;
          }
          
          // Try session storage next
          const backupJSON = sessionStorage.getItem('watchlist_backup');
          if (backupJSON) {
            const backup = JSON.parse(backupJSON);
            if (backup && backup.userId === currentUser.id && Array.isArray(backup.entries)) {
              console.log(`Using session storage backup from ${new Date(backup.timestamp).toLocaleString()}`);
              return backup.entries;
            }
          }
        } catch (backupError) {
          console.error('Error using backup watchlist:', backupError);
        }
        
        // Return empty array as last resort
        console.log('No valid backup found, returning empty watchlist');
        return [];
      }
    },
    refetchOnWindowFocus: true, // Refresh when window regains focus
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Filter and sort watchlist
  const filteredAndSortedWatchlist = (): WatchlistEntryWithMovie[] => {
    if (!watchlist) return [];

    // First filter by media type, genre, platform, and search query
    let filtered: WatchlistEntryWithMovie[] = watchlist;
    
    // Filter by media type
    if (mediaTypeFilter !== 'all') {
      filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
        entry.movie.mediaType === mediaTypeFilter
      );
    }
    
    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
        entry.status === statusFilter
      );
    }
    
    // Filter by genre
    if (selectedGenre && selectedGenre !== 'all') {
      filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
        entry.movie.genres?.includes(selectedGenre)
      );
    }
    
    // Filter by platform
    if (selectedPlatform && selectedPlatform !== 'all') {
      if (selectedPlatform === 'none') {
        // Filter entries with no platform
        filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
          !entry.platformId
        );
      } else {
        // Filter by specific platform ID
        const platformId = parseInt(selectedPlatform);
        filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
          entry.platformId === platformId
        );
      }
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((entry: WatchlistEntryWithMovie) => 
        entry.movie.title.toLowerCase().includes(query) || 
        (entry.movie.overview && entry.movie.overview.toLowerCase().includes(query)) ||
        (entry.notes && entry.notes.toLowerCase().includes(query))
      );
    }

    // Then sort
    return [...filtered].sort((a: WatchlistEntryWithMovie, b: WatchlistEntryWithMovie) => {
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
    setEditStatus(entry.status || 'watched'); // Set the current status
    
    // Always fetch fresh platforms when editing
    if (currentUser?.id) {
      // First set the current platform ID from the entry
      setEditPlatformId(entry.platformId || null);
      
      // Then fetch platforms to ensure we have the latest data
      fetchPlatforms(currentUser.id).then(platformsData => {
        // If entry has no platform but there's a default platform available, use it
        if (!entry.platformId && platformsData.length > 0) {
          const defaultPlatform = platformsData.find((p: Platform) => p.isDefault === true);
          if (defaultPlatform) {
            setEditPlatformId(defaultPlatform.id);
          }
        }
      });
    }
    
    setIsEditModalOpen(true);
  };
  
  // Fetch platforms
  const fetchPlatforms = async (userId: number): Promise<Platform[]> => {
    if (loadingPlatforms) return [];
    
    setLoadingPlatforms(true);
    try {
      const response = await apiRequest('GET', `/api/platforms/${userId}`);
      if (response.ok) {
        const data = await response.json();
        setPlatforms(data);
        
        // If we have a default platform and no platform is selected, use default
        if (editPlatformId === null) {
          const defaultPlatform = data.find((p: Platform) => p.isDefault === true);
          if (defaultPlatform) {
            setEditPlatformId(defaultPlatform.id);
          }
        }
        
        return data; // Return the platforms data for use in other functions
      } else {
        console.error('Failed to fetch platforms:', response.status);
        return [];
      }
    } catch (error) {
      console.error('Error fetching platforms:', error);
      return [];
    } finally {
      setLoadingPlatforms(false);
    }
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
        watchedDate: editStatus === 'watched' ? editWatchedDate || null : null,
        notes: editNotes || null,
        status: editStatus,
        platformId: editPlatformId,
        userId: currentUser?.id, // Add userId to ensure server-side validation passes
      });
      
      const statusLabel = editStatus === 'to_watch' 
        ? 'to watch list' 
        : editStatus === 'watching' 
          ? 'currently watching list'
          : 'watched list';
      
      // Find platform name if a platform is selected
      const selectedPlatform = editPlatformId
        ? platforms.find(p => p.id === editPlatformId)?.name
        : null;
      
      const platformText = selectedPlatform 
        ? ` on ${selectedPlatform}`
        : '';
          
      toast({
        title: "Entry updated",
        description: `${entryToEdit.movie.title} has been updated in your ${statusLabel}${platformText}`,
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
    if (!entryToDelete || !currentUser) return;
    
    try {
      // Include the userId as a query parameter to satisfy the hasJwtWatchlistAccess middleware
      const userId = currentUser.id;
      
      console.log(`[WATCHLIST] Deleting entry ${entryToDelete} for user ${userId}`);
      
      // First try to include userId in the URL query params
      await apiRequest('DELETE', `/api/watchlist/${entryToDelete}?userId=${userId}`, undefined, {
        headers: {
          // Add backup user information to help server with auth checks
          'X-User-ID': userId.toString(),
          'X-Username': currentUser.username
        }
      });
      
      toast({
        title: "Entry removed",
        description: "The item has been removed from your watched list",
      });
      
      // Invalidate the watchlist cache
      queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${userId}`] });
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
    watchlist.forEach((entry: WatchlistEntryWithMovie) => {
      const genres = entry.movie.genres || '';
      genres.split(',').forEach((genre: string) => {
        if (genre.trim()) genreSet.add(genre.trim());
      });
    });
    
    return Array.from(genreSet).sort();
  };

  // Get watchlist stats
  const getWatchlistStats = () => {
    if (!watchlist) return { total: 0, movies: 0, tv: 0 };
    
    const movies = watchlist.filter((entry: WatchlistEntryWithMovie) => entry.movie.mediaType === 'movie').length;
    const tv = watchlist.filter((entry: WatchlistEntryWithMovie) => entry.movie.mediaType === 'tv').length;
    
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
  
  const statusFilters = [
    { value: 'all', label: 'All', icon: Menu },
    { value: 'to_watch', label: 'To Watch', icon: Clock },
    { value: 'watching', label: 'Watching', icon: PlayCircle },
    { value: 'watched', label: 'Watched', icon: CheckCircle },
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
          <div className="flex flex-row items-center flex-wrap mb-2 md:mb-0">
            <h2 className="text-xl font-bold font-heading flex items-center">
              Watchlist
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({stats.total} {stats.total === 1 ? 'item' : 'items'})
              </span>
            </h2>
            
            {/* Media Type Stats - Now moved next to the title on both mobile and desktop */}
            <div className="flex space-x-2 items-center ml-3">
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
          
          {/* Empty div to maintain layout with justify-between */}
          <div>

            
            {/* Safari Mobile-specific refresh button */}
            {isMobileSafari && (
              <button 
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
                  toast({
                    title: "Refreshing watchlist",
                    description: "Loading the latest data...",
                  });
                }}
                className="ml-2 p-1 rounded-full hover:bg-gray-700"
                aria-label="Refresh watchlist"
              >
                <RefreshCw className="h-4 w-4 text-gray-400" />
              </button>
            )}
          </div>
        </div>
        
        {/* Status Filter Tabs (Desktop) */}
        <div className="hidden md:flex justify-center mb-4">
          <div className="inline-flex items-center rounded-lg bg-[#292929] p-1 mb-3">
            {statusFilters.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.value}
                  className={`flex items-center px-3 py-2 text-sm rounded-md transition ${
                    statusFilter === filter.value 
                      ? 'bg-[#E50914] text-white' 
                      : 'text-gray-300 hover:text-white'
                  }`}
                  onClick={() => setStatusFilter(filter.value as StatusFilterType)}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {filter.label}
                </button>
              );
            })}
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

        {/* Status Filter - iOS-friendly segmented control (Mobile) */}
        <div className="md:hidden mb-4 px-3">
          <div className="overflow-x-auto pb-2">
            <div className="inline-flex items-center rounded-lg bg-[#292929] p-1 shadow-inner space-x-1 min-w-[350px]">
              {statusFilters.map((filter) => {
                const Icon = filter.icon;
                return (
                  <button
                    key={filter.value}
                    className={`flex items-center justify-center px-3 py-2.5 rounded-md text-sm transition ${
                      statusFilter === filter.value 
                        ? 'bg-[#3d3d3d] text-white font-medium shadow-sm' 
                        : 'text-gray-300 hover:bg-[#3d3d3d]/50'
                    }`}
                    onClick={() => setStatusFilter(filter.value as StatusFilterType)}
                  >
                    <Icon className={`h-4 w-4 mr-1.5 ${statusFilter === filter.value ? 'text-[#E50914]' : ''}`} />
                    <span>{filter.label}</span>
                  </button>
                );
              })}
            </div>
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
        
        {/* Search Bar - iOS optimized */}
        <div className="mb-3 px-3">
          <div className="relative">
            <div className="absolute inset-y-0 start-0 flex items-center ps-3 pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <Input
              ref={searchInputRef}
              type="search"
              placeholder="Search your watchlist..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#292929] border-gray-700 ps-10 pe-10 focus:ring-[#E50914] focus:border-[#E50914] h-11 rounded-lg"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 end-0 flex items-center pe-3"
                aria-label="Clear search"
              >
                <div className="bg-gray-700 rounded-full p-1.5">
                  <X className="h-3 w-3 text-gray-300" />
                </div>
              </button>
            )}
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
          
          <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
            <SelectTrigger className="bg-[#292929] text-white border-gray-700 focus:ring-[#E50914] h-10">
              <SelectValue placeholder="All Platforms" />
            </SelectTrigger>
            <SelectContent className="bg-[#292929] text-white border-gray-700 max-h-[50vh]">
              <SelectItem value="all" className="py-2.5">All Platforms</SelectItem>
              <SelectItem value="none" className="py-2.5">No Platform</SelectItem>
              {platforms.sort((a, b) => a.name.localeCompare(b.name)).map((platform) => (
                <SelectItem key={platform.id} value={platform.id.toString()} className="py-2.5">
                  {platform.name}
                  {platform.isDefault && (
                    <span className="ml-2 text-xs text-green-500">(Default)</span>
                  )}
                </SelectItem>
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
        <>
          {searchQuery.trim() && (
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800/50 mb-3 mx-3 rounded-md">
              <div className="flex items-center text-sm">
                <Search className="h-4 w-4 text-gray-400 mr-2" />
                <span>Search results for "<span className="text-white font-medium">{searchQuery}</span>"</span>
              </div>
              <Badge variant="secondary" className="h-6 bg-gray-700">
                {filteredAndSortedWatchlist().length} {filteredAndSortedWatchlist().length === 1 ? 'result' : 'results'}
              </Badge>
            </div>
          )}
          
          {filteredAndSortedWatchlist().length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-3">
              {filteredAndSortedWatchlist().map((entry: WatchlistEntryWithMovie) => (
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
                  <Search className="h-12 w-12 opacity-50" />
                </div>
                <p className="text-gray-300 font-medium text-lg">
                  No matches found
                </p>
                <p className="text-gray-400 text-sm mt-1 mb-4">
                  Try adjusting your search or filters to find what you're looking for
                </p>
                {/* iOS-optimized clear button */}
                <div className="space-y-3">
                  <Button 
                    variant="outline" 
                    onClick={() => setSearchQuery('')}
                    className="w-full py-2.5 h-12 text-base border-gray-600"
                    disabled={!searchQuery}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear search
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedGenre('all');
                      setSelectedPlatform('all');
                      setMediaTypeFilter('all');
                    }}
                    className="w-full py-2.5 h-12 text-base bg-gray-800 border-gray-600"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Reset all filters
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
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
                ? "Your watchlist is empty"
                : `No ${mediaTypeFilter === 'movie' ? 'movies' : 'TV shows'} in your watchlist`
              }
            </p>
            <p className="text-gray-400 text-sm mt-1">
              {mediaTypeFilter === 'all' 
                ? "Search for movies and TV shows to add to your watchlist."
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
              Are you sure you want to remove this item from your watchlist?
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
        <DialogContent className="bg-[#292929] text-white border-gray-700 p-4 pb-6">
          {/* Custom close button for better mobile visibility */}
          <button 
            className="absolute right-4 top-4 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-600 p-1"
            onClick={() => setIsEditModalOpen(false)}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
          
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold pr-6">
              {editStatus === 'to_watch' 
                ? 'Edit To Watch' 
                : editStatus === 'watching' 
                  ? 'Edit Currently Watching'
                  : 'Edit Watched'}
            </DialogTitle>
            {entryToEdit && (
              <p className="text-sm text-gray-400 mt-1 line-clamp-1">{entryToEdit.movie.title}</p>
            )}
          </DialogHeader>
          
          {entryToEdit && (
            <form onSubmit={(e) => { e.preventDefault(); handleUpdateEntry(); }}>
              <div className="mb-4">
                <Label className="text-sm font-medium block mb-2">Watch Status</Label>
                <RadioGroup 
                  value={editStatus} 
                  onValueChange={setEditStatus}
                  className="space-y-2"
                >
                  <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                    <RadioGroupItem value="to_watch" id="edit-status-to-watch" />
                    <Label htmlFor="edit-status-to-watch" className="flex items-center gap-2 cursor-pointer">
                      <Clock className="h-4 w-4 text-blue-400" />
                      <div>
                        <div className="font-medium">To Watch</div>
                        <div className="text-xs text-gray-400">Save for later</div>
                      </div>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                    <RadioGroupItem value="watching" id="edit-status-watching" />
                    <Label htmlFor="edit-status-watching" className="flex items-center gap-2 cursor-pointer">
                      <PlayCircle className="h-4 w-4 text-green-400" />
                      <div>
                        <div className="font-medium">Currently Watching</div>
                        <div className="text-xs text-gray-400">Started but not finished</div>
                      </div>
                    </Label>
                  </div>
                  
                  <div className="flex items-center space-x-2 bg-gray-800 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer">
                    <RadioGroupItem value="watched" id="edit-status-watched" />
                    <Label htmlFor="edit-status-watched" className="flex items-center gap-2 cursor-pointer">
                      <CheckCircle className="h-4 w-4 text-[#E50914]" />
                      <div>
                        <div className="font-medium">Watched</div>
                        <div className="text-xs text-gray-400">Already completed</div>
                      </div>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              
              {editStatus === 'watched' && (
                <div className="mb-4">
                  <Label htmlFor="edit-watch-date" className="text-sm font-medium mb-2 block">When did you watch it?</Label>
                  <Input 
                    type="date" 
                    id="edit-watch-date" 
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600 h-12 text-base sm:text-sm"
                    value={editWatchedDate}
                    onChange={(e) => setEditWatchedDate(e.target.value)}
                  />
                </div>
              )}
              
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="edit-platform" className="text-sm font-medium">Platform (optional)</Label>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      // Dispatch custom event to open platform management
                      window.dispatchEvent(new CustomEvent('openPlatformManagement'));
                    }}
                    className="text-xs h-7 px-2 py-0 bg-gray-800 hover:bg-gray-700 text-gray-200"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Manage Platforms
                  </Button>
                </div>
                <Select 
                  value={editPlatformId ? editPlatformId.toString() : 'none'} 
                  onValueChange={(value) => setEditPlatformId(value !== 'none' ? parseInt(value) : null)}
                >
                  <SelectTrigger className="w-full bg-gray-700 text-white border-gray-600 focus:ring-[#E50914] h-12">
                    <SelectValue placeholder="Where did you watch it?" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="none">No platform</SelectItem>
                    {platforms
                      .slice() // Create a copy to avoid mutating the original array
                      .sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically by name
                      .map((platform) => (
                        <SelectItem key={platform.id} value={platform.id.toString()}>
                          <div className="flex items-center">
                            {platform.name}
                            {platform.isDefault && (
                              <span className="ml-2 bg-green-700 text-white text-xs px-1.5 py-0.5 rounded-full">Default</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <div className="mt-2 text-xs text-gray-400 flex items-center">
                  <span>Want to add a new platform? </span>
                  <button 
                    type="button"
                    onClick={() => {
                      // Close the edit modal first to prevent UI conflicts
                      setIsEditModalOpen(false);
                      // Then open the platform management modal (assumed to be handled elsewhere)
                      if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('openPlatformManagement'));
                      }
                    }} 
                    className="ml-1 text-blue-400 hover:text-blue-300 underline"
                  >
                    Manage platforms
                  </button>
                </div>
              </div>
              
              <div className="mb-6">
                <Label htmlFor="edit-watch-notes" className="text-sm font-medium mb-2 block">Notes (optional)</Label>
                <Textarea 
                  id="edit-watch-notes" 
                  rows={4} 
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-[#E50914] border-gray-600"
                  placeholder={`Add your thoughts about the ${entryToEdit?.movie?.mediaType === 'tv' ? 'show' : 'movie'}...`}
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
                  ) : (
                    editStatus === 'to_watch' 
                      ? 'Update To Watch' 
                      : editStatus === 'watching' 
                        ? 'Update Currently Watching'
                        : 'Update Watched'
                  )}
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
          showAddToWatchlistButton={false}
          onAddToWatchlist={() => {
            toast({
              title: "Already in watched list",
              description: "This item is already in your watched list",
            });
          }}
        />
      )}

      {/* Platform Management Modal */}
      {currentUser && (
        <PlatformManagementModal
          isOpen={isPlatformModalOpen}
          onClose={() => setIsPlatformModalOpen(false)}
          onPlatformsUpdated={() => {
            if (currentUser) {
              // Refresh platforms when updates are made
              fetchPlatforms(currentUser.id);
              // Also refresh watchlist to update platform names displayed
              queryClient.invalidateQueries({ queryKey: [`/api/watchlist/${currentUser.id}`] });
            }
          }}
        />
      )}
    </div>
  );
};

export default WatchlistPage;
