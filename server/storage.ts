import { 
  users, type User, type InsertUser,
  movies, type Movie, type InsertMovie,
  watchlistEntries, type WatchlistEntry, type InsertWatchlistEntry,
  type WatchlistEntryWithMovie
} from "@shared/schema";
import Database from 'better-sqlite3';
import { join } from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = join('.', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

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
  hasWatchlistEntry(userId: number, movieId: number): Promise<boolean>;
  createWatchlistEntry(entry: InsertWatchlistEntry): Promise<WatchlistEntry>;
  updateWatchlistEntry(id: number, entry: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined>;
  deleteWatchlistEntry(id: number): Promise<boolean>;
}

export class SQLiteStorage implements IStorage {
  private db: Database.Database;

  constructor() {
    // Initialize database
    const dbPath = join(dataDir, 'movietrack.sqlite');
    this.db = new Database(dbPath);
    
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    this.setupDatabase();
    
    // Create a default user if none exists
    this.ensureDefaultUser();
  }

  private setupDatabase() {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE
      )
    `);

    // Movies table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tmdbId INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        overview TEXT,
        posterPath TEXT,
        backdropPath TEXT,
        releaseDate TEXT,
        voteAverage TEXT,
        genres TEXT,
        mediaType TEXT
      )
    `);

    // Watchlist entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        movieId INTEGER NOT NULL,
        watchedDate TEXT,
        notes TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (movieId) REFERENCES movies(id) ON DELETE CASCADE
      )
    `);
  }

  private async ensureDefaultUser() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get() as { count: number };
    
    if (result.count === 0) {
      await this.createUser({ username: 'Guest' });
    }
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(id) as User | undefined;
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)');
    const user = stmt.get(username) as User | undefined;
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const stmt = this.db.prepare('INSERT INTO users (username) VALUES (?)');
    const result = stmt.run(insertUser.username);
    
    return {
      id: Number(result.lastInsertRowid),
      username: insertUser.username
    };
  }

  async getAllUsers(): Promise<User[]> {
    const stmt = this.db.prepare('SELECT * FROM users');
    const users = stmt.all() as User[];
    return users;
  }

  // Movie operations
  async getMovie(id: number): Promise<Movie | undefined> {
    const stmt = this.db.prepare('SELECT * FROM movies WHERE id = ?');
    const movie = stmt.get(id) as Movie | undefined;
    return movie;
  }

  async getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined> {
    const stmt = this.db.prepare('SELECT * FROM movies WHERE tmdbId = ?');
    const movie = stmt.get(tmdbId) as Movie | undefined;
    return movie;
  }

  async createMovie(insertMovie: InsertMovie): Promise<Movie> {
    const stmt = this.db.prepare(`
      INSERT INTO movies (
        tmdbId, title, overview, posterPath, backdropPath, 
        releaseDate, voteAverage, genres, mediaType
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      insertMovie.tmdbId,
      insertMovie.title,
      insertMovie.overview || null,
      insertMovie.posterPath || null,
      insertMovie.backdropPath || null,
      insertMovie.releaseDate || null,
      insertMovie.voteAverage || null,
      insertMovie.genres || null,
      insertMovie.mediaType || 'movie'
    );
    
    return {
      id: Number(result.lastInsertRowid),
      tmdbId: insertMovie.tmdbId,
      title: insertMovie.title,
      overview: insertMovie.overview || null,
      posterPath: insertMovie.posterPath || null,
      backdropPath: insertMovie.backdropPath || null,
      releaseDate: insertMovie.releaseDate || null,
      voteAverage: insertMovie.voteAverage || null,
      genres: insertMovie.genres || null,
      mediaType: insertMovie.mediaType || 'movie'
    };
  }

  // Watchlist operations
  async getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined> {
    const stmt = this.db.prepare('SELECT * FROM watchlist_entries WHERE id = ?');
    const entry = stmt.get(id) as WatchlistEntry | undefined;
    return entry;
  }

  async getWatchlistEntries(userId: number): Promise<WatchlistEntryWithMovie[]> {
    const stmt = this.db.prepare(`
      SELECT 
        we.id, we.userId, we.movieId, we.watchedDate, we.notes, we.createdAt,
        m.id as movie_id, m.tmdbId, m.title, m.overview, m.posterPath, m.backdropPath, 
        m.releaseDate, m.voteAverage, m.genres, m.mediaType
      FROM watchlist_entries we
      JOIN movies m ON we.movieId = m.id
      WHERE we.userId = ?
    `);
    
    const results = stmt.all(userId) as any[];
    
    return results.map(row => ({
      id: row.id,
      userId: row.userId,
      movieId: row.movieId,
      watchedDate: row.watchedDate,
      notes: row.notes,
      createdAt: new Date(row.createdAt),
      movie: {
        id: row.movie_id,
        tmdbId: row.tmdbId,
        title: row.title,
        overview: row.overview,
        posterPath: row.posterPath,
        backdropPath: row.backdropPath,
        releaseDate: row.releaseDate,
        voteAverage: row.voteAverage,
        genres: row.genres,
        mediaType: row.mediaType
      }
    }));
  }
  
  async hasWatchlistEntry(userId: number, movieId: number): Promise<boolean> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM watchlist_entries
      WHERE userId = ? AND movieId = ?
    `);
    
    const result = stmt.get(userId, movieId) as { count: number };
    return result.count > 0;
  }

  async createWatchlistEntry(insertEntry: InsertWatchlistEntry): Promise<WatchlistEntry> {
    // Convert Date objects to ISO strings for SQLite
    let watchedDate = null;
    if (insertEntry.watchedDate) {
      // If it's already a string, use it as is
      if (typeof insertEntry.watchedDate === 'string') {
        watchedDate = insertEntry.watchedDate;
      } 
      // If it's a Date object, convert to ISO string
      else if (insertEntry.watchedDate instanceof Date) {
        watchedDate = insertEntry.watchedDate.toISOString();
      }
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO watchlist_entries (userId, movieId, watchedDate, notes)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      insertEntry.userId,
      insertEntry.movieId,
      watchedDate,
      insertEntry.notes || null
    );
    
    return {
      id: Number(result.lastInsertRowid),
      userId: insertEntry.userId,
      movieId: insertEntry.movieId,
      watchedDate: insertEntry.watchedDate || null,
      notes: insertEntry.notes || null,
      createdAt: new Date()
    };
  }

  async updateWatchlistEntry(id: number, updates: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined> {
    // First, check if the entry exists
    const existingEntry = await this.getWatchlistEntry(id);
    if (!existingEntry) {
      return undefined;
    }
    
    // Build the SET clause dynamically based on provided updates
    const setClauses = [];
    const params = [];
    
    if (updates.userId !== undefined) {
      setClauses.push('userId = ?');
      params.push(updates.userId);
    }
    
    if (updates.movieId !== undefined) {
      setClauses.push('movieId = ?');
      params.push(updates.movieId);
    }
    
    if (updates.watchedDate !== undefined) {
      setClauses.push('watchedDate = ?');
      // Convert Date objects to ISO strings for SQLite
      if (updates.watchedDate instanceof Date) {
        params.push(updates.watchedDate.toISOString());
      } else {
        params.push(updates.watchedDate);
      }
    }
    
    if (updates.notes !== undefined) {
      setClauses.push('notes = ?');
      params.push(updates.notes);
    }
    
    if (setClauses.length === 0) {
      // No updates provided
      return existingEntry;
    }
    
    // Add the ID parameter
    params.push(id);
    
    // Execute the update
    const query = `
      UPDATE watchlist_entries 
      SET ${setClauses.join(', ')} 
      WHERE id = ?
    `;
    
    const stmt = this.db.prepare(query);
    stmt.run(...params);
    
    // Return the updated entry
    return {
      ...existingEntry,
      ...updates
    };
  }

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM watchlist_entries WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}

// For backward compatibility, we also keep the MemStorage implementation
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
  
  async hasWatchlistEntry(userId: number, movieId: number): Promise<boolean> {
    return Array.from(this.watchlistEntries.values()).some(
      entry => entry.userId === userId && entry.movieId === movieId
    );
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

// Switch from MemStorage to SQLiteStorage
export const storage = new SQLiteStorage();
