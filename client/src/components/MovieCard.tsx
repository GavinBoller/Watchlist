import { useState, useEffect } from 'react';
import { TMDBMovie } from '@shared/schema';
import { getImageUrl, getTitle, getReleaseDate, getMediaType, formatMovieDisplay, getIMDbUrl, formatRuntime, getMovieDetails } from '@/api/tmdb';
import { Star, Info, ExternalLink, PlusCircle, Clock, Tv2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface MovieCardProps {
  movie: TMDBMovie;
  onAddToWatchlist: (movie: TMDBMovie) => void;
  onShowDetails?: (movie: TMDBMovie) => void;
}

const MovieCard = ({ movie, onAddToWatchlist, onShowDetails }: MovieCardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const isMobile = useIsMobile();
  const [imdbUrl, setImdbUrl] = useState('');
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const [runtime, setRuntime] = useState<string>('');
  const [tvInfo, setTvInfo] = useState<string>('');
  
  // Safe data extraction with error handling 
  let posterUrl, title, mediaType, displayInfo, voteAverage;
  
  try {
    posterUrl = getImageUrl(movie.poster_path);
    title = getTitle(movie);
    mediaType = getMediaType(movie);
    displayInfo = formatMovieDisplay(movie);
    
    // Format vote average to one decimal place with safety checks
    voteAverage = (movie.vote_average !== undefined && movie.vote_average !== null) 
      ? (typeof movie.vote_average === 'number' 
        ? movie.vote_average.toFixed(1) 
        : String(movie.vote_average))
      : 'N/A';
  } catch (error) {
    console.error('Error processing movie data:', error, movie);
    // Fallback values
    posterUrl = null;
    title = movie.title || movie.name || 'Unknown Title';
    mediaType = movie.media_type || 'movie';
    displayInfo = '';
    voteAverage = 'N/A';
  }

  // Get media type badge text and color
  const typeBadge = mediaType === 'tv' ? 'TV' : 'Movie';
  const badgeClass = mediaType === 'tv' ? 'bg-blue-600' : 'bg-[#E50914]';
  
  // Determine if info should be shown (hover on desktop, tap on mobile)
  const shouldShowInfo = isMobile ? showInfo : isHovered;

  // For mobile devices, use touch events instead of hover
  useEffect(() => {
    if (isMobile) {
      // Reset info visibility when component re-renders
      setShowInfo(false);
    }
  }, [isMobile, movie.id]);
  
  // Fetch runtime or TV show information when component mounts or movie changes
  useEffect(() => {
    const fetchMediaDetails = async () => {
      try {
        if (mediaType === 'movie') {
          // Check if we already have runtime data in the movie object
          if (movie.runtime) {
            setRuntime(formatRuntime(movie.runtime));
            return;
          }
          
          // Otherwise fetch from the API
          const details = await getMovieDetails(movie.id, 'movie');
          if (details && details.runtime) {
            setRuntime(formatRuntime(details.runtime));
          }
        } else if (mediaType === 'tv') {
          // Check if we already have TV show data in the movie object
          if (movie.number_of_seasons && movie.number_of_episodes) {
            const seasonText = movie.number_of_seasons === 1 ? 'season' : 'seasons';
            const episodeText = movie.number_of_episodes === 1 ? 'episode' : 'episodes';
            setTvInfo(`${movie.number_of_seasons} ${seasonText}, ${movie.number_of_episodes} ${episodeText}`);
            return;
          }
          
          // Otherwise fetch from the API
          const details = await getMovieDetails(movie.id, 'tv');
          if (details) {
            const seasons = details.number_of_seasons || 0;
            const episodes = details.number_of_episodes || 0;
            const seasonText = seasons === 1 ? 'season' : 'seasons';
            const episodeText = episodes === 1 ? 'episode' : 'episodes';
            setTvInfo(`${seasons} ${seasonText}, ${episodes} ${episodeText}`);
          }
        }
      } catch (error) {
        console.error(`Error fetching ${mediaType} details:`, error);
      }
    };
    
    fetchMediaDetails();
  }, [movie.id, mediaType, movie.runtime, movie.number_of_seasons, movie.number_of_episodes]);

  // Fetch IMDb URL when component mounts or movie changes
  useEffect(() => {
    const fetchImdbUrl = async () => {
      setIsLoadingUrl(true);
      try {
        const url = await getIMDbUrl(movie.id, mediaType, title);
        setImdbUrl(url);
      } catch (error) {
        console.error('Error fetching IMDb URL:', error);
        // Fallback to search URL
        setImdbUrl(`https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt`);
      } finally {
        setIsLoadingUrl(false);
      }
    };
    
    fetchImdbUrl();
  }, [movie.id, mediaType, title]);

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToWatchlist(movie);
  };
  
  const handleInfoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onShowDetails) {
      onShowDetails(movie);
    }
  };

  const handleTap = () => {
    if (isMobile) {
      setShowInfo(!showInfo);
    }
  };
  
  // Handle IMDb button click for mobile
  const handleImdbClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (imdbUrl) {
      window.open(imdbUrl, '_blank', 'noopener');
    } else {
      window.open(`https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt`, '_blank', 'noopener');
    }
  };

  return (
    <div 
      className="movie-card relative rounded-lg overflow-hidden group cursor-pointer touch-manipulation"
      onMouseEnter={() => !isMobile && setIsHovered(true)}
      onMouseLeave={() => !isMobile && setIsHovered(false)}
      onClick={handleTap}
      data-movie-id={movie.id}
    >
      <div className="relative">
        <img 
          src={posterUrl || 'https://via.placeholder.com/300x450?text=No+Image'} 
          alt={title}
          className="w-full aspect-[2/3] object-cover"
          loading="lazy"
        />
        <div className={`absolute top-2 right-2 ${badgeClass} text-white text-xs font-bold py-1 px-2 rounded-full`}>
          {typeBadge}
        </div>
        {/* Add to watchlist quick button for mobile */}
        {isMobile && !showInfo && (
          <div className="absolute bottom-2 right-2 z-10" onClick={(e) => e.stopPropagation()}>
            <button 
              type="button"
              className="bg-[#E50914] text-white rounded-full p-2 shadow-lg touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddToWatchlist(movie);
                return false;
              }}
              aria-label="Add to watchlist"
            >
              <PlusCircle className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
      <div 
        className={`movie-info absolute inset-0 bg-black bg-opacity-85 flex flex-col justify-end p-3 transition-opacity duration-300 ${
          shouldShowInfo ? 'opacity-100' : 'opacity-0'
        } ${isMobile ? 'touch-auto' : ''}`}
      >
        <h3 className="font-bold text-sm sm:text-base md:text-lg">{title}</h3>
        <p className="text-xs sm:text-sm text-gray-300">{displayInfo}</p>
        {/* Runtime or TV show info display */}
        {(runtime || tvInfo) && (
          <div className="flex items-center text-xs text-gray-400 mt-1">
            {mediaType === 'movie' && runtime && (
              <>
                <Clock className="h-3 w-3 mr-1" />
                <span>{runtime}</span>
              </>
            )}
            {mediaType === 'tv' && tvInfo && (
              <>
                <Tv2 className="h-3 w-3 mr-1" />
                <span>{tvInfo}</span>
              </>
            )}
          </div>
        )}
        <div className="flex items-center mt-1">
          <span className="text-[#F5C518] font-bold text-xs sm:text-sm">{voteAverage}</span>
          <div className="ml-1">
            <Star className="h-3 w-3 sm:h-4 sm:w-4 text-[#F5C518] fill-current" />
          </div>
        </div>
        
        {/* Desktop layout for buttons */}
        {!isMobile && (
          <div className="flex mt-2 space-x-2">
            {onShowDetails && (
              <button 
                className="bg-gray-700 text-white text-xs rounded-full py-1 px-3 hover:bg-gray-600 transition flex items-center"
                onClick={handleInfoClick}
                aria-label="Show details"
              >
                <Info className="h-3 w-3 mr-1" />
                Details
              </button>
            )}
            <a 
              href={imdbUrl || `https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt`} 
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#F5C518] text-black text-xs rounded-full py-1 px-3 hover:bg-yellow-400 transition flex items-center"
              onClick={(e) => e.stopPropagation()}
              aria-label="View on IMDb"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              IMDb
            </a>
            <button 
              className="bg-[#E50914] text-white text-xs rounded-full py-1 px-3 hover:bg-red-700 transition flex-grow"
              onClick={handleAddClick}
            >
              + Add to Watchlist
            </button>
          </div>
        )}
        
        {/* Mobile layout with stacked buttons for better touch targets */}
        {isMobile && (
          <div className="flex flex-col mt-3 space-y-2">
            <button 
              className="bg-[#E50914] text-white text-sm font-medium rounded-lg py-2 px-3 hover:bg-red-700 transition flex items-center justify-center touch-manipulation"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onAddToWatchlist(movie);
              }}
            >
              <PlusCircle className="h-4 w-4 mr-2" />
              Add to Watchlist
            </button>
            
            <div className="flex space-x-2">
              {onShowDetails && (
                <button 
                  className="bg-gray-700 text-white text-sm rounded-lg py-2 flex-1 hover:bg-gray-600 transition flex items-center justify-center touch-manipulation"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (onShowDetails) {
                      onShowDetails(movie);
                    }
                  }}
                  aria-label="Show details"
                  type="button"
                >
                  <Info className="h-4 w-4 mr-1" />
                  Details
                </button>
              )}
              <button 
                type="button"
                className="bg-[#F5C518] text-black text-sm rounded-lg py-2 flex-1 hover:bg-yellow-400 transition flex items-center justify-center touch-manipulation"
                onClick={handleImdbClick}
                aria-label="View on IMDb"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                IMDb
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MovieCard;
