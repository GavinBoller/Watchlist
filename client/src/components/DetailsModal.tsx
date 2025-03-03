import { TMDBMovie } from '@shared/schema';
import { getImageUrl, getTitle, getMediaType, formatMovieDisplay, getIMDbUrl } from '@/api/tmdb';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from '@/components/ui/dialog';
import { Star, Calendar, Tag, ExternalLink, Plus, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface DetailsModalProps {
  item: TMDBMovie | null;
  isOpen: boolean;
  onClose: () => void;
  onAddToWatchlist: (item: TMDBMovie) => void;
}

export const DetailsModal = ({ item, isOpen, onClose, onAddToWatchlist }: DetailsModalProps) => {
  const isMobile = useIsMobile();
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
      <DialogContent className={`bg-[#292929] text-white border-gray-700 ${isMobile ? 'max-w-[90vw] p-4' : 'sm:max-w-xl'}`}>
        {/* Custom close button for better mobile visibility */}
        <DialogClose className="absolute right-4 top-4 rounded-full hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-600 p-1">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
        
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl pr-6">{title}</DialogTitle>
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
          
          <div className={`flex flex-col ${isMobile ? 'gap-3' : 'sm:flex-row gap-4'} relative z-10`}>
            {/* Poster image - smaller on mobile */}
            <div className={isMobile ? 'w-full flex justify-center' : 'sm:w-1/3'}>
              <img 
                src={posterUrl || 'https://via.placeholder.com/200x300?text=No+Image'}
                alt={title} 
                className={`rounded-lg ${isMobile ? 'max-h-[200px] object-contain' : 'w-full object-cover'}`}
              />
            </div>
            
            {/* Content section */}
            <div className={`${isMobile ? 'w-full' : 'sm:w-2/3'} space-y-3`}>
              {/* Rating and media type */}
              <div className="flex items-center text-sm">
                <Star className="h-5 w-5 text-[#F5C518] fill-current mr-2" />
                <span className="text-[#F5C518] font-bold">{voteAverage}</span>
                <span className="mx-2">•</span>
                <Tag className="h-4 w-4 mr-1" />
                <span className="capitalize">{mediaType}</span>
              </div>
              
              {/* Overview section */}
              <div className="text-sm prose-sm prose-invert">
                <h4 className="text-white mb-1 text-base font-medium">Overview</h4>
                <p className={`text-gray-300 leading-relaxed ${isMobile ? 'max-h-[150px] overflow-y-auto' : ''}`}>
                  {item.overview || "No overview available."}
                </p>
              </div>
              
              {/* Action buttons - stacked on mobile, row on desktop */}
              <div className={`flex ${isMobile ? 'flex-col gap-3 mt-4' : 'flex-row gap-2 mt-2'}`}>
                <button 
                  className={`bg-[#E50914] text-white ${isMobile ? 'py-3' : 'py-2'} px-4 rounded-lg hover:bg-red-700 transition w-full flex items-center justify-center font-medium`}
                  onClick={handleAddToWatchlist}
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Add to Watchlist
                </button>
                
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    const url = await getIMDbUrl(item.id, mediaType, title);
                    window.open(url, '_blank', 'noopener');
                  }}
                  className={`bg-[#F5C518] text-black ${isMobile ? 'py-3' : 'py-2'} px-4 rounded-lg hover:bg-yellow-400 transition flex items-center justify-center w-full font-medium`}
                >
                  <ExternalLink className="h-5 w-5 mr-2" />
                  View on IMDb
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};