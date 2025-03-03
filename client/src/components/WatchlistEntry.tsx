import { format } from 'date-fns';
import { WatchlistEntryWithMovie } from '@shared/schema';
import { getImageUrl, getGenreNames, getIMDbUrl } from '@/api/tmdb';
import { Star, Trash2, Edit, Info, Calendar, Tv2, Film, ExternalLink } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useState, useEffect } from 'react';

interface WatchlistEntryProps {
  entry: WatchlistEntryWithMovie;
  onEdit: (entry: WatchlistEntryWithMovie) => void;
  onDelete: (entryId: number) => void;
  onShowDetails?: (entry: WatchlistEntryWithMovie) => void;
}

const WatchlistEntry = ({ entry, onEdit, onDelete, onShowDetails }: WatchlistEntryProps) => {
  const { movie, watchedDate, id, notes } = entry;
  const isMobile = useIsMobile();
  const [imdbUrl, setImdbUrl] = useState<string>('');
  const [isLoadingUrl, setIsLoadingUrl] = useState<boolean>(false);
  
  const posterUrl = getImageUrl(movie.posterPath, 'w200');
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear().toString() : '';
  // For stored entries, the genres are already comma-separated strings of genre names
  const genres = movie.genres || '';
  const mediaType = movie.mediaType || 'movie';
  
  // Format the watched date
  const formattedDate = watchedDate 
    ? format(new Date(watchedDate), 'MMMM d, yyyy')
    : 'Not specified';
  
  // Format vote average with one decimal place if provided
  const voteAverage = movie.voteAverage || 'N/A';
  
  // Media type icon
  const MediaTypeIcon = mediaType === 'tv' ? Tv2 : Film;
  
  // Fetch IMDb URL when component mounts
  useEffect(() => {
    const fetchImdbUrl = async () => {
      setIsLoadingUrl(true);
      try {
        const url = await getIMDbUrl(movie.tmdbId, mediaType, movie.title);
        setImdbUrl(url);
      } catch (error) {
        console.error('Error fetching IMDb URL:', error);
        // Fallback to search URL
        setImdbUrl(`https://www.imdb.com/find/?q=${encodeURIComponent(movie.title)}&s=tt`);
      } finally {
        setIsLoadingUrl(false);
      }
    };
    
    fetchImdbUrl();
  }, [movie.tmdbId, mediaType, movie.title]);

  return (
    <div className={`bg-[#292929] rounded-lg overflow-hidden ${isMobile ? 'flex flex-col' : 'flex'}`}>
      {/* Poster section */}
      <div className={`relative ${isMobile ? 'w-full h-40' : 'h-full'}`}>
        <img 
          src={posterUrl || 'https://via.placeholder.com/200x300?text=No+Image'} 
          alt={movie.title} 
          className={`${isMobile ? 'w-full h-40 object-cover object-center' : 'w-24 md:w-28 object-cover h-full'}`}
          loading="lazy"
        />
        <div className={`absolute top-2 right-2 ${mediaType === 'tv' ? 'bg-blue-600' : 'bg-[#E50914]'} text-white text-xs font-bold py-1 px-2 rounded-full`}>
          {mediaType === 'tv' ? 'TV' : 'Movie'}
        </div>
      </div>
      
      {/* Content section */}
      <div className="p-3 flex flex-col flex-grow">
        {/* Title and rating */}
        <div className="flex justify-between">
          <div className="flex items-center max-w-[80%]">
            <h3 className="font-bold text-md truncate">{movie.title}</h3>
            {onShowDetails && (
              <button 
                className="ml-2 text-gray-400 hover:text-white flex-shrink-0"
                onClick={() => onShowDetails(entry)}
                aria-label="Show details"
              >
                <Info className="h-5 w-5" />
              </button>
            )}
          </div>
          <div className="flex items-center">
            <span className="text-[#F5C518] font-bold text-xs">{voteAverage}</span>
            <div className="ml-1">
              <Star className="h-3 w-3 text-[#F5C518] fill-current" />
            </div>
          </div>
        </div>
        
        {/* Year and genres */}
        <div className="flex items-center text-xs text-gray-300 mt-1">
          <MediaTypeIcon className="h-3 w-3 mr-1 flex-shrink-0" />
          <span className="truncate">{year}{genres ? ` • ${genres}` : ''}</span>
        </div>
        
        {/* Watched date */}
        <div className="mt-2 flex items-center text-xs text-gray-300">
          <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
          <span className="whitespace-nowrap">Watched on:</span> 
          <span className="text-[#44C8E8] ml-1 truncate">{formattedDate}</span>
        </div>
        
        {/* Notes */}
        {notes && (
          <div className="mt-2 text-xs text-gray-300 italic line-clamp-2">
            "{notes}"
          </div>
        )}
        
        {/* Action buttons */}
        {isMobile ? (
          // Mobile layout - larger buttons with text labels for better touch targets
          <div className="mt-3 grid grid-cols-3 gap-2">
            <a 
              href={imdbUrl || `https://www.imdb.com/find/?q=${encodeURIComponent(movie.title)}&s=tt`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center justify-center bg-[#F5C518] text-black py-2 px-3 rounded-lg"
              aria-label="View on IMDb"
            >
              <ExternalLink className="h-4 w-4 mr-1" />
              <span className="text-xs font-medium">IMDb</span>
            </a>
            <button 
              className="flex items-center justify-center bg-gray-700 text-white py-2 px-3 rounded-lg"
              onClick={() => onEdit(entry)}
              aria-label="Edit entry"
            >
              <Edit className="h-4 w-4 mr-1" />
              <span className="text-xs font-medium">Edit</span>
            </button>
            <button 
              className="flex items-center justify-center bg-[#E50914] text-white py-2 px-3 rounded-lg"
              onClick={() => onDelete(id)}
              aria-label="Delete entry"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              <span className="text-xs font-medium">Delete</span>
            </button>
          </div>
        ) : (
          // Desktop layout
          <div className="mt-auto pt-2 flex justify-end items-center">
            <a 
              href={imdbUrl || `https://www.imdb.com/find/?q=${encodeURIComponent(movie.title)}&s=tt`} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-xs text-[#F5C518] hover:text-yellow-400 mr-3"
              aria-label="View on IMDb"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <button 
              className="text-xs text-gray-300 hover:text-white mr-3"
              onClick={() => onEdit(entry)}
              aria-label="Edit entry"
            >
              <Edit className="h-4 w-4" />
            </button>
            <button 
              className="text-xs text-gray-300 hover:text-[#E50914]"
              onClick={() => onDelete(id)}
              aria-label="Delete entry"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default WatchlistEntry;
