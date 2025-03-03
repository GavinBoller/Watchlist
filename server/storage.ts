import { 
  users, type User, type InsertUser,
  movies, type Movie, type InsertMovie,
  watchlistEntries, type WatchlistEntry, type InsertWatchlistEntry,
  type WatchlistEntryWithMovie
} from "@shared/schema";

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  // Movie operations
  getMovie(id: number): Promise<Movie | undefined>;
  getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined>;
  createMovie(movie: InsertMovie): Promise<Movie>;

  // Watchlist operations
  getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined>;
  getWatchlistEntries(userId: number): Promise<WatchlistEntryWithMovie[]>;
  createWatchlistEntry(entry: InsertWatchlistEntry): Promise<WatchlistEntry>;
  updateWatchlistEntry(id: number, entry: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined>;
  deleteWatchlistEntry(id: number): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private movies: Map<number, Movie>;
  private watchlistEntries: Map<number, WatchlistEntry>;
  private userCurrentId: number;
  private movieCurrentId: number;
  private watchlistEntryCurrentId: number;

  constructor() {
    this.users = new Map();
    this.movies = new Map();
    this.watchlistEntries = new Map();
    this.userCurrentId = 1;
    this.movieCurrentId = 1;
    this.watchlistEntryCurrentId = 1;
    
    // Add a default user
    this.createUser({ username: "Guest" });
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username.toLowerCase() === username.toLowerCase(),
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userCurrentId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  // Movie operations
  async getMovie(id: number): Promise<Movie | undefined> {
    return this.movies.get(id);
  }

  async getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined> {
    return Array.from(this.movies.values()).find(
      (movie) => movie.tmdbId === tmdbId,
    );
  }

  async createMovie(insertMovie: InsertMovie): Promise<Movie> {
    const id = this.movieCurrentId++;
    const movie: Movie = { 
      ...insertMovie, 
      id,
      mediaType: insertMovie.mediaType || 'movie',
      overview: insertMovie.overview || null,
      posterPath: insertMovie.posterPath || null,
      backdropPath: insertMovie.backdropPath || null,
      releaseDate: insertMovie.releaseDate || null,
      voteAverage: insertMovie.voteAverage || null,
      genres: insertMovie.genres || null
    };
    this.movies.set(id, movie);
    return movie;
  }

  // Watchlist operations
  async getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined> {
    return this.watchlistEntries.get(id);
  }

  async getWatchlistEntries(userId: number): Promise<WatchlistEntryWithMovie[]> {
    const entries = Array.from(this.watchlistEntries.values()).filter(
      (entry) => entry.userId === userId
    );

    return entries.map(entry => {
      const movie = this.movies.get(entry.movieId);
      if (!movie) {
        throw new Error(`Movie with id ${entry.movieId} not found`);
      }
      return { ...entry, movie };
    });
  }

  async createWatchlistEntry(insertEntry: InsertWatchlistEntry): Promise<WatchlistEntry> {
    const id = this.watchlistEntryCurrentId++;
    const entry: WatchlistEntry = {
      userId: insertEntry.userId,
      movieId: insertEntry.movieId,
      watchedDate: insertEntry.watchedDate || null,
      notes: insertEntry.notes || null,
      id,
      createdAt: new Date()
    };
    this.watchlistEntries.set(id, entry);
    return entry;
  }

  async updateWatchlistEntry(id: number, updates: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined> {
    const existingEntry = this.watchlistEntries.get(id);
    if (!existingEntry) {
      return undefined;
    }

    const updatedEntry: WatchlistEntry = {
      ...existingEntry,
      ...updates,
    };
    this.watchlistEntries.set(id, updatedEntry);
    return updatedEntry;
  }

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    return this.watchlistEntries.delete(id);
  }
}

export const storage = new MemStorage();
