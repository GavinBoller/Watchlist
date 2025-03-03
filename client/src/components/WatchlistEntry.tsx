import { format } from 'date-fns';
import { WatchlistEntryWithMovie } from '@shared/schema';
import { getImageUrl, getReleaseYear, getGenreNames } from '@/api/tmdb';
import { Star, Trash2, Edit } from 'lucide-react';

interface WatchlistEntryProps {
  entry: WatchlistEntryWithMovie;
  onEdit: (entry: WatchlistEntryWithMovie) => void;
  onDelete: (entryId: number) => void;
}

const WatchlistEntry = ({ entry, onEdit, onDelete }: WatchlistEntryProps) => {
  const { movie, watchedDate, id } = entry;
  
  const posterUrl = getImageUrl(movie.posterPath, 'w200');
  const year = getReleaseYear(movie.releaseDate);
  const genres = getGenreNames(movie.genres);
  
  // Format the watched date
  const formattedDate = watchedDate 
    ? format(new Date(watchedDate), 'MMMM d, yyyy')
    : 'Not specified';
  
  // Format vote average with one decimal place if provided
  const voteAverage = movie.voteAverage || 'N/A';

  return (
    <div className="bg-[#292929] rounded-lg overflow-hidden flex">
      <img 
        src={posterUrl || 'https://via.placeholder.com/200x300?text=No+Image'} 
        alt={movie.title} 
        className="w-24 md:w-28 object-cover"
        loading="lazy"
      />
      <div className="p-3 flex flex-col flex-grow">
        <div className="flex justify-between">
          <h3 className="font-bold text-md">{movie.title}</h3>
          <div className="flex items-center">
            <span className="text-[#F5C518] font-bold text-xs">{voteAverage}</span>
            <div className="ml-1">
              <Star className="h-3 w-3 text-[#F5C518] fill-current" />
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-300">{year}{genres ? ` • ${genres}` : ''}</p>
        <div className="mt-2 flex items-center text-xs text-gray-300">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          Watched on: <span className="text-[#44C8E8] ml-1">{formattedDate}</span>
        </div>
        <div className="mt-auto pt-2 flex justify-end">
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
      </div>
    </div>
  );
};

export default WatchlistEntry;
