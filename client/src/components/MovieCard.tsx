import { useState } from 'react';
import { TMDBMovie } from '@shared/schema';
import { getImageUrl, getTitle, getReleaseDate, getMediaType, formatMovieDisplay, getIMDbUrl } from '@/api/tmdb';
import { Star, Info, ExternalLink } from 'lucide-react';

interface MovieCardProps {
  movie: TMDBMovie;
  onAddToWatchlist: (movie: TMDBMovie) => void;
  onShowDetails?: (movie: TMDBMovie) => void;
}

const MovieCard = ({ movie, onAddToWatchlist, onShowDetails }: MovieCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

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

  const posterUrl = getImageUrl(movie.poster_path);
  const title = getTitle(movie);
  const mediaType = getMediaType(movie);
  const displayInfo = formatMovieDisplay(movie);
  
  // Format vote average to one decimal place
  const voteAverage = movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A';

  // Get media type badge text and color
  const typeBadge = mediaType === 'tv' ? 'TV' : 'Movie';
  const badgeClass = mediaType === 'tv' ? 'bg-blue-600' : 'bg-[#E50914]';

  return (
    <div 
      className="movie-card relative rounded-lg overflow-hidden group cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
      </div>
      <div 
        className={`movie-info absolute inset-0 bg-black bg-opacity-75 flex flex-col justify-end p-3 transition-opacity duration-300 ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <h3 className="font-bold text-sm sm:text-base">{title}</h3>
        <p className="text-xs text-gray-300">{displayInfo}</p>
        <div className="flex items-center mt-1">
          <span className="text-[#F5C518] font-bold text-xs">{voteAverage}</span>
          <div className="ml-1">
            <Star className="h-3 w-3 text-[#F5C518] fill-current" />
          </div>
        </div>
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
            href={getIMDbUrl(movie.id, mediaType)} 
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
      </div>
    </div>
  );
};

export default MovieCard;
