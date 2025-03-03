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

// Convert genre IDs to genre names
export const getGenreNames = (genreIds: number[] | string, mediaType: string = 'movie'): string => {
  const genreMap = mediaType === 'tv' ? tvGenreMap : movieGenreMap;
  
  if (typeof genreIds === 'string') {
    if (!genreIds) return '';
    return genreIds.split(',')
      .map(id => genreMap[Number(id)] || '')
      .filter(Boolean)
      .join(', ');
  }
  
  return genreIds
    .map(id => genreMap[id] || '')
    .filter(Boolean)
    .join(', ');
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

// Format for display with genres
export const formatMovieDisplay = (item: TMDBMovie): string => {
  const mediaType = getMediaType(item);
  const year = getReleaseYear(getReleaseDate(item));
  const genres = getGenreNames(item.genre_ids, mediaType);
  return `${year}${genres ? ' • ' + genres : ''}${mediaType === 'tv' ? ' • TV Series' : ''}`;
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
