import { useState } from 'react';
import { TMDBMovie } from '@shared/schema';
import { getImageUrl, getReleaseYear, getGenreNames } from '@/api/tmdb';
import { Star } from 'lucide-react';

interface MovieCardProps {
  movie: TMDBMovie;
  onAddToWatchlist: (movie: TMDBMovie) => void;
}

const MovieCard = ({ movie, onAddToWatchlist }: MovieCardProps) => {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onAddToWatchlist(movie);
  };

  const posterUrl = getImageUrl(movie.poster_path);
  const year = getReleaseYear(movie.release_date);
  const genres = getGenreNames(movie.genre_ids);
  
  // Format vote average to one decimal place
  const voteAverage = movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A';

  return (
    <div 
      className="movie-card relative rounded-lg overflow-hidden group cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-movie-id={movie.id}
    >
      <img 
        src={posterUrl || 'https://via.placeholder.com/300x450?text=No+Image'} 
        alt={movie.title} 
        className="w-full aspect-[2/3] object-cover"
        loading="lazy"
      />
      <div 
        className={`movie-info absolute inset-0 bg-black bg-opacity-75 flex flex-col justify-end p-3 transition-opacity duration-300 ${
          isHovered ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <h3 className="font-bold text-sm sm:text-base">{movie.title}</h3>
        <p className="text-xs text-gray-300">{year}{genres ? ` • ${genres}` : ''}</p>
        <div className="flex items-center mt-1">
          <span className="text-[#F5C518] font-bold text-xs">{voteAverage}</span>
          <div className="ml-1">
            <Star className="h-3 w-3 text-[#F5C518] fill-current" />
          </div>
        </div>
        <button 
          className="mt-2 bg-[#E50914] text-white text-xs rounded-full py-1 px-3 hover:bg-red-700 transition"
          onClick={handleClick}
        >
          + Add to Watchlist
        </button>
      </div>
    </div>
  );
};

export default MovieCard;
