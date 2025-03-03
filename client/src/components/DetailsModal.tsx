import { TMDBMovie } from '@shared/schema';
import { getImageUrl, getTitle, getMediaType, formatMovieDisplay } from '@/api/tmdb';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Star, Calendar, Tag } from 'lucide-react';

interface DetailsModalProps {
  item: TMDBMovie | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToWatchlist: (item: TMDBMovie) => void;
}

export const DetailsModal = ({ item, isOpen, onClose, onAddToWatchlist }: DetailsModalProps) => {
  if (!item) return null;

  const title = getTitle(item);
  const mediaType = getMediaType(item);
  const displayInfo = formatMovieDisplay(item);
  const posterUrl = getImageUrl(item.poster_path, 'w200');
  const backdropUrl = getImageUrl(item.backdrop_path, 'w500');
  
  // Format vote average to one decimal place
  const voteAverage = item.vote_average ? item.vote_average.toFixed(1) : 'N/A';

  const handleAddToWatchlist = () => {
    onAddToWatchlist(item);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#292929] text-white border-gray-700 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">{title}</DialogTitle>
          <DialogDescription className="text-gray-300">
            {displayInfo}
          </DialogDescription>
        </DialogHeader>
        
        <div className="relative">
          {backdropUrl && (
            <div className="absolute inset-0 opacity-20 z-0">
              <img 
                src={backdropUrl} 
                alt={`${title} backdrop`} 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#292929] to-transparent" />
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row gap-4 relative z-10">
            <div className="sm:w-1/3">
              <img 
                src={posterUrl || 'https://via.placeholder.com/200x300?text=No+Image'}
                alt={title} 
                className="rounded-lg w-full object-cover"
              />
            </div>
            
            <div className="sm:w-2/3 space-y-4">
              <div className="flex items-center text-sm">
                <Star className="h-5 w-5 text-[#F5C518] fill-current mr-2" />
                <span className="text-[#F5C518] font-bold">{voteAverage}</span>
                <span className="mx-2">•</span>
                <Tag className="h-4 w-4 mr-1" />
                <span className="capitalize">{mediaType}</span>
              </div>
              
              <div className="text-sm prose-sm prose-invert">
                <h4 className="text-white mb-1">Overview</h4>
                <p className="text-gray-300 leading-relaxed">
                  {item.overview || "No overview available."}
                </p>
              </div>
              
              <button 
                className="mt-4 bg-[#E50914] text-white py-2 px-4 rounded-lg hover:bg-red-700 transition w-full sm:w-auto"
                onClick={handleAddToWatchlist}
              >
                Add to Watchlist
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};