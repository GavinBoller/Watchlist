import { format } from 'date-fns';
import { WatchlistEntryWithMovie } from '@shared/schema';
import { getImageUrl, getGenreNames } from '@/api/tmdb';
import { Star, Trash2, Edit, Info, Calendar, Tv2, Film } from 'lucide-react';

interface WatchlistEntryProps {
  entry: WatchlistEntryWithMovie;
  onEdit: (entry: WatchlistEntryWithMovie) => void;
  onDelete: (entryId: number) => void;
  onShowDetails?: (entry: WatchlistEntryWithMovie) => void;
}

const WatchlistEntry = ({ entry, onEdit, onDelete, onShowDetails }: WatchlistEntryProps) => {
  const { movie, watchedDate, id, notes } = entry;
  
  const posterUrl = getImageUrl(movie.posterPath, 'w200');
  const year = movie.releaseDate ? new Date(movie.releaseDate).getFullYear().toString() : '';
  const genres = getGenreNames(movie.genres, movie.mediaType);
  const mediaType = movie.mediaType || 'movie';
  
  // Format the watched date
  const formattedDate = watchedDate 
    ? format(new Date(watchedDate), 'MMMM d, yyyy')
    : 'Not specified';
  
  // Format vote average with one decimal place if provided
  const voteAverage = movie.voteAverage || 'N/A';
  
  // Media type icon
  const MediaTypeIcon = mediaType === 'tv' ? Tv2 : Film;

  return (
    <div className="bg-[#292929] rounded-lg overflow-hidden flex">
      <div className="relative">
        <img 
          src={posterUrl || 'https://via.placeholder.com/200x300?text=No+Image'} 
          alt={movie.title} 
          className="w-24 md:w-28 object-cover h-full"
          loading="lazy"
        />
        <div className={`absolute top-2 right-2 ${mediaType === 'tv' ? 'bg-blue-600' : 'bg-[#E50914]'} text-white text-xs font-bold py-1 px-2 rounded-full`}>
          {mediaType === 'tv' ? 'TV' : 'Movie'}
        </div>
      </div>
      <div className="p-3 flex flex-col flex-grow">
        <div className="flex justify-between">
          <div className="flex items-center">
            <h3 className="font-bold text-md">{movie.title}</h3>
            {onShowDetails && (
              <button 
                className="ml-2 text-gray-400 hover:text-white"
                onClick={() => onShowDetails(entry)}
                aria-label="Show details"
              >
                <Info className="h-4 w-4" />
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
        <div className="flex items-center text-xs text-gray-300 mt-1">
          <MediaTypeIcon className="h-3 w-3 mr-1" />
          <span>{year}{genres ? ` • ${genres}` : ''}</span>
        </div>
        <div className="mt-2 flex items-center text-xs text-gray-300">
          <Calendar className="h-3 w-3 mr-1" />
          Watched on: <span className="text-[#44C8E8] ml-1">{formattedDate}</span>
        </div>
        {notes && (
          <div className="mt-2 text-xs text-gray-300 italic line-clamp-2">
            "{notes}"
          </div>
        )}
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
