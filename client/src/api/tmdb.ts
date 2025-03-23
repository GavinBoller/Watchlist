import { TMDBSearchResponse, TMDBMovie } from '@shared/schema';

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';
const IMDB_BASE_URL = 'https://www.imdb.com/title/';

// Helper function to get image URLs of different sizes
export const getImageUrl = (path: string | null, size: 'w500' | 'original' | 'w200' = 'w500') => {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}${size}${path}`;
};

// Genre mapping (TMDB genre IDs to names)
export const movieGenreMap: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

// TV show genre mapping
export const tvGenreMap: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western'
};

// Convert genre IDs to genre names with enhanced error handling
export const getGenreNames = (genreIds: number[] | string | unknown, mediaType: string = 'movie'): string => {
  try {
    // Safety check for undefined/null input
    if (!genreIds) return '';
    
    const genreMap = mediaType === 'tv' ? tvGenreMap : movieGenreMap;
    
    // Handle string format
    if (typeof genreIds === 'string') {
      if (genreIds.trim() === '') return '';
      
      return genreIds.split(',')
        .map(id => {
          const numId = Number(id.trim());
          return isNaN(numId) ? '' : (genreMap[numId] || '');
        })
        .filter(Boolean)
        .join(', ');
    }
    
    // Handle array format
    if (Array.isArray(genreIds)) {
      return genreIds
        .filter(id => id !== null && id !== undefined)
        .map(id => {
          // Handle potential non-number items in array
          const numId = typeof id === 'number' ? id : Number(id);
          return isNaN(numId) ? '' : (genreMap[numId] || '');
        })
        .filter(Boolean)
        .join(', ');
    }
    
    // If unknown format, return empty string
    console.warn('Unknown format for genre IDs:', genreIds);
    return '';
  } catch (error) {
    console.error('Error processing genre IDs:', error, genreIds);
    return '';
  }
};

// Get title of the movie or TV show
export const getTitle = (item: TMDBMovie): string => {
  return item.title || item.name || 'Unknown Title';
};

// Get the release date of the movie or TV show
export const getReleaseDate = (item: TMDBMovie): string | undefined => {
  return item.release_date || item.first_air_date;
};

// Get the release year from a date string
export const getReleaseYear = (releaseDate: string | undefined | null): string => {
  if (!releaseDate) return '';
  return new Date(releaseDate).getFullYear().toString();
};

// Get the media type (movie or tv)
export const getMediaType = (item: TMDBMovie): string => {
  return item.media_type || 'movie';
};

// Format for display with runtime, seasons/episodes info, and genres
export const formatMovieDisplay = (item: TMDBMovie): string => {
  try {
    // Safely extract information with error handling
    const mediaType = getMediaType(item);
    const year = getReleaseYear(getReleaseDate(item));
    
    // Check if genre_ids is present and in the expected format
    let genres = '';
    if (item.genre_ids && Array.isArray(item.genre_ids)) {
      genres = getGenreNames(item.genre_ids, mediaType);
    } else if (item.genre_ids && typeof item.genre_ids === 'string') {
      genres = getGenreNames(item.genre_ids, mediaType);
    }
    
    // Add runtime for movies or seasons/episodes for TV shows
    let additionalInfo = '';
    if (mediaType === 'movie' && item.runtime) {
      additionalInfo = ` • ${formatRuntime(item.runtime)}`;
    } else if (mediaType === 'tv') {
      if (item.number_of_seasons && item.number_of_episodes) {
        const seasonText = item.number_of_seasons === 1 ? 'season' : 'seasons';
        const episodeText = item.number_of_episodes === 1 ? 'episode' : 'episodes';
        additionalInfo = ` • ${item.number_of_seasons} ${seasonText}, ${item.number_of_episodes} ${episodeText}`;
      } else {
        additionalInfo = ' • TV Series';
      }
    }
    
    return `${year}${additionalInfo}${genres ? ' • ' + genres : ''}`;
  } catch (error) {
    console.warn('Error formatting movie display info:', error, item);
    return item.release_date || item.first_air_date || '';
  }
};

// Cache for IMDb IDs to avoid repeated API calls
const imdbIdCache: Record<string, string> = {};

// Get external IDs including IMDb ID
export const getExternalIds = async (tmdbId: number, mediaType: string = 'movie'): Promise<{imdb_id?: string}> => {
  try {
    const cacheKey = `${mediaType}_${tmdbId}`;
    
    // First check the cache
    if (imdbIdCache[cacheKey]) {
      return { imdb_id: imdbIdCache[cacheKey] };
    }
    
    const response = await fetch(`/api/movies/external-ids/${tmdbId}?mediaType=${mediaType}`);
    if (!response.ok) {
      throw new Error('Failed to fetch external IDs');
    }
    
    const data = await response.json();
    
    // Save to cache
    if (data.imdb_id) {
      imdbIdCache[cacheKey] = data.imdb_id;
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching external IDs:', error);
    return {};
  }
};

// Get IMDb URL for the movie or TV show
export const getIMDbUrl = async (tmdbId: number, mediaType: string = 'movie', title?: string): Promise<string> => {
  try {
    // Try to get the IMDb ID first
    const externalIds = await getExternalIds(tmdbId, mediaType);
    
    if (externalIds.imdb_id) {
      return `${IMDB_BASE_URL}${externalIds.imdb_id}`;
    } 
    
    // If we couldn't get the IMDb ID, fall back to search
    if (title) {
      return `https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt`;
    } 
    
    // Last resort fallback
    return `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
  } catch (error) {
    // If anything fails, use the search URL
    if (title) {
      return `https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt`;
    } else {
      return `https://www.themoviedb.org/${mediaType}/${tmdbId}`;
    }
  }
};

// Search TMDB for movies and TV shows
export const searchMovies = async (query: string, mediaType: string = 'all'): Promise<TMDBSearchResponse> => {
  try {
    const response = await fetch(`/api/movies/search?query=${encodeURIComponent(query)}&mediaType=${mediaType}`);
    if (!response.ok) {
      throw new Error('Failed to search movies and TV shows');
    }
    return await response.json();
  } catch (error) {
    console.error('Error searching media:', error);
    throw error;
  }
};

// Cache for movie details to avoid repeated API calls
const movieDetailsCache: Record<string, any> = {};

// Get movie or TV show details including runtime
export const getMovieDetails = async (tmdbId: number, mediaType: string = 'movie'): Promise<any> => {
  try {
    const cacheKey = `${mediaType}_${tmdbId}`;
    
    // First check the cache
    if (movieDetailsCache[cacheKey]) {
      return movieDetailsCache[cacheKey];
    }
    
    const response = await fetch(`/api/movies/details/${tmdbId}?mediaType=${mediaType}`);
    if (!response.ok) {
      throw new Error('Failed to fetch movie details');
    }
    
    const data = await response.json();
    
    // Save to cache
    movieDetailsCache[cacheKey] = data;
    
    return data;
  } catch (error) {
    console.error('Error fetching movie details:', error);
    return {};
  }
};

// Format runtime from minutes to hours and minutes
export const formatRuntime = (runtime?: number | null): string => {
  if (!runtime) return '';
  
  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;
  
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  
  return `${hours}h ${minutes}m`;
};
