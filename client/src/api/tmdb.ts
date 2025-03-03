import { TMDBSearchResponse, TMDBMovie } from '@shared/schema';

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';

// Helper function to get image URLs of different sizes
export const getImageUrl = (path: string | null, size: 'w500' | 'original' | 'w200' = 'w500') => {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE_URL}${size}${path}`;
};

// Genre mapping (TMDB genre IDs to names)
export const genreMap: Record<number, string> = {
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

// Convert genre IDs to genre names
export const getGenreNames = (genreIds: number[] | string): string => {
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

// Get the release year from a date string
export const getReleaseYear = (releaseDate: string | undefined | null): string => {
  if (!releaseDate) return '';
  return new Date(releaseDate).getFullYear().toString();
};

// Format for display with genres
export const formatMovieDisplay = (movie: TMDBMovie): string => {
  const year = getReleaseYear(movie.release_date);
  const genres = getGenreNames(movie.genre_ids);
  return `${year}${genres ? ' • ' + genres : ''}`;
};

// Search TMDB for movies
export const searchMovies = async (query: string): Promise<TMDBSearchResponse> => {
  try {
    const response = await fetch(`/api/movies/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error('Failed to search movies');
    }
    return await response.json();
  } catch (error) {
    console.error('Error searching movies:', error);
    throw error;
  }
};
