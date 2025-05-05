export type User = {
    id: number;
    username: string;
    password: string | null;
    displayName: string | null;
    createdAt: Date;
    environment: string | null;
    role?: string;
  };
  
  export type UserResponse = {
    id: number;
    username: string;
    displayName: string | null; // Nullable but required
    createdAt: Date;
    environment: string | null; // Nullable but required
  };
  
  export type Movie = {
    id: number;
    tmdbId: number;
    title: string;
    overview: string | null;
    posterPath: string | null;
    backdropPath: string | null;
    releaseDate: string | null;
    voteAverage: number | null;
    genres: string[] | null;
    runtime: number | null;
    mediaType: 'movie' | 'tv' | null;
    numberOfSeasons: number | null;
    numberOfEpisodes: number | null;
  };
  
  export type Platform = {
    id: number;
    userId: number;
    name: string;
    logoUrl: string | null;
    isDefault: boolean;
  };
  
  export type WatchlistEntry = {
    id: number;
    userId: number;
    movieId: number;
    platformId: number | null;
    status: 'to_watch' | 'watching' | 'watched' | null;
    watchedDate: Date | null;
    notes: string | null;
    createdAt: Date;
  };
  
  export type InsertMovie = Omit<Movie, 'id'>;
  export type InsertPlatform = Omit<Platform, 'id'>;
  export type InsertWatchlistEntry = Omit<WatchlistEntry, 'id' | 'createdAt'>;