import { 
  users, type User, type InsertUser,
  movies, type Movie, type InsertMovie,
  watchlistEntries, type WatchlistEntry, type InsertWatchlistEntry,
  type WatchlistEntryWithMovie
} from "@shared/schema";
import Database from 'better-sqlite3';
import { join } from 'path';
import fs from 'fs';
import { db } from "./db";
import { eq, and } from "drizzle-orm";

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
  updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined>;
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
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL DEFAULT '',
        display_name TEXT,
        is_private INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add new columns for authentication if they don't exist (for existing databases)
    try {
      const hasPasswordColumn = this.db.prepare("PRAGMA table_info(users)").all()
        .some((col: any) => col.name === 'password');
      
      if (!hasPasswordColumn) {
        // Add columns one by one (SQLite limits ALTER TABLE functionality)
        this.db.exec(`ALTER TABLE users ADD COLUMN password TEXT NOT NULL DEFAULT ''`);
        this.db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
        this.db.exec(`ALTER TABLE users ADD COLUMN created_at TEXT`);
        
        // Update existing rows to set created_at value
        this.db.exec(`UPDATE users SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);
        
        console.log("Added authentication columns to users table");
      }
    } catch (error) {
      console.error("Failed to check or add auth columns:", error);
    }

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
        status TEXT NOT NULL DEFAULT 'to_watch',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (movieId) REFERENCES movies(id) ON DELETE CASCADE
      )
    `);
    
    // Add status column if it doesn't exist (for existing databases)
    try {
      const hasStatusColumn = this.db.prepare("PRAGMA table_info(watchlist_entries)").all()
        .some((col: any) => col.name === 'status');
      
      if (!hasStatusColumn) {
        this.db.exec("ALTER TABLE watchlist_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'to_watch'");
        console.log("Added status column to watchlist_entries table");
      }
    } catch (error) {
      console.error("Failed to check or add status column:", error);
    }
  }

  private async ensureDefaultUser() {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get() as { count: number };
    
    if (result.count === 0) {
      // Create default guest user with a hashed password
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash('guest', 10);
      
      await this.createUser({ 
        username: 'Guest', 
        password: passwordHash,
        displayName: 'Guest User'
      });
    }
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const stmt = this.db.prepare(`
      SELECT id, username, password, display_name as displayName, 
             created_at as createdAt 
      FROM users WHERE id = ?
    `);
    const user = stmt.get(id) as User | undefined;
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const stmt = this.db.prepare(`
      SELECT id, username, password, display_name as displayName, 
             created_at as createdAt
      FROM users WHERE LOWER(username) = LOWER(?)
    `);
    const user = stmt.get(username) as User | undefined;
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const stmt = this.db.prepare(`
      INSERT INTO users (username, password, display_name) 
      VALUES (?, ?, ?)
    `);
    
    const result = stmt.run(
      insertUser.username,
      insertUser.password,
      insertUser.displayName || null
    );
    
    return {
      id: Number(result.lastInsertRowid),
      username: insertUser.username,
      password: insertUser.password,
      displayName: insertUser.displayName || null,
      createdAt: new Date()
    };
  }

  async getAllUsers(): Promise<User[]> {
    const stmt = this.db.prepare(`
      SELECT id, username, password, display_name as displayName, 
             created_at as createdAt
      FROM users
    `);
    const users = stmt.all() as User[];
    return users;
  }
  
  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    // First, check if the user exists
    const user = await this.getUser(id);
    if (!user) {
      return undefined;
    }
    
    // Build the SET clause dynamically based on provided updates
    const setClauses = [];
    const params = [];
    
    if (updates.username !== undefined) {
      setClauses.push('username = ?');
      params.push(updates.username);
    }
    
    if (updates.password !== undefined) {
      setClauses.push('password = ?');
      params.push(updates.password);
    }
    
    if (updates.displayName !== undefined) {
      setClauses.push('display_name = ?');
      params.push(updates.displayName);
    }
    
    if (setClauses.length === 0) {
      // No updates provided
      return user;
    }
    
    // Add the ID parameter
    params.push(id);
    
    // Execute the update
    const query = `
      UPDATE users 
      SET ${setClauses.join(', ')} 
      WHERE id = ?
    `;
    
    const stmt = this.db.prepare(query);
    stmt.run(...params);
    
    // Return the updated user
    return {
      ...user,
      ...updates,
      // Make sure we use the correct field names when merging
      displayName: updates.displayName !== undefined ? updates.displayName : user.displayName
    };
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
        we.id, we.userId, we.movieId, we.watchedDate, we.notes, we.status, we.createdAt,
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
      status: row.status || 'to_watch', // Default to 'to_watch' if not set
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
    // Get watchedDate value
    let watchedDate = insertEntry.watchedDate || null;
    
    const stmt = this.db.prepare(`
      INSERT INTO watchlist_entries (userId, movieId, watchedDate, notes, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      insertEntry.userId,
      insertEntry.movieId,
      watchedDate,
      insertEntry.notes || null,
      insertEntry.status || 'to_watch'
    );
    
    return {
      id: Number(result.lastInsertRowid),
      userId: insertEntry.userId,
      movieId: insertEntry.movieId,
      watchedDate: watchedDate,
      notes: insertEntry.notes || null,
      status: insertEntry.status || 'to_watch',
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
      params.push(updates.watchedDate);
    }
    
    if (updates.notes !== undefined) {
      setClauses.push('notes = ?');
      params.push(updates.notes);
    }
    
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
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
    
    // Add a default user with a password
    const bcrypt = require('bcryptjs');
    const passwordHash = bcrypt.hashSync('guest', 10);
    
    this.createUser({
      username: "Guest",
      password: passwordHash,
      displayName: "Guest User"
    });
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
    const user: User = { 
      ...insertUser, 
      id,
      displayName: insertUser.displayName || null,
      createdAt: new Date()
    };
    this.users.set(id, user);
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }
  
  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser: User = {
      ...user,
      ...updates,
      // Make sure we use the correct field names when merging
      displayName: updates.displayName !== undefined ? updates.displayName : user.displayName
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
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
      status: insertEntry.status || 'to_watch',
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

// DatabaseStorage implementation for PostgreSQL
export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }
  
  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    // Check if user exists
    const user = await this.getUser(id);
    if (!user) return undefined;
    
    // Update only provided fields
    const [updatedUser] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    
    return updatedUser;
  }

  async getMovie(id: number): Promise<Movie | undefined> {
    const [movie] = await db.select().from(movies).where(eq(movies.id, id));
    return movie || undefined;
  }

  async getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined> {
    const [movie] = await db.select().from(movies).where(eq(movies.tmdbId, tmdbId));
    return movie || undefined;
  }

  async createMovie(insertMovie: InsertMovie): Promise<Movie> {
    const [movie] = await db
      .insert(movies)
      .values(insertMovie)
      .returning();
    return movie;
  }

  async getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined> {
    const [entry] = await db.select().from(watchlistEntries).where(eq(watchlistEntries.id, id));
    return entry || undefined;
  }

  async getWatchlistEntries(userId: number): Promise<WatchlistEntryWithMovie[]> {
    const entries = await db
      .select()
      .from(watchlistEntries)
      .where(eq(watchlistEntries.userId, userId));
    
    const result: WatchlistEntryWithMovie[] = [];
    
    for (const entry of entries) {
      const [movie] = await db.select().from(movies).where(eq(movies.id, entry.movieId));
      if (movie) {
        result.push({
          ...entry,
          movie
        });
      }
    }
    
    return result;
  }

  async hasWatchlistEntry(userId: number, movieId: number): Promise<boolean> {
    const entries = await db
      .select()
      .from(watchlistEntries)
      .where(
        and(
          eq(watchlistEntries.userId, userId),
          eq(watchlistEntries.movieId, movieId)
        )
      );
    
    return entries.length > 0;
  }

  async createWatchlistEntry(insertEntry: InsertWatchlistEntry): Promise<WatchlistEntry> {
    const [entry] = await db
      .insert(watchlistEntries)
      .values(insertEntry)
      .returning();
    
    return entry;
  }

  async updateWatchlistEntry(id: number, updates: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined> {
    // Check if entry exists
    const entry = await this.getWatchlistEntry(id);
    if (!entry) return undefined;
    
    // Update only provided fields
    const [updatedEntry] = await db
      .update(watchlistEntries)
      .set(updates)
      .where(eq(watchlistEntries.id, id))
      .returning();
    
    return updatedEntry;
  }

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    const result = await db
      .delete(watchlistEntries)
      .where(eq(watchlistEntries.id, id))
      .returning({ id: watchlistEntries.id });
    
    return result.length > 0;
  }
}

// Initialize default user in the database
async function initializeDefaultUser() {
  try {
    if (!process.env.DATABASE_URL) {
      console.warn('Skipping database user initialization: No DATABASE_URL provided');
      return;
    }
    
    // Check if db is properly initialized
    if (!db) {
      console.warn('Database not initialized yet, skipping default user creation');
      return;
    }
    
    // Check if we need to create a default user
    try {
      const existingUsers = await db.select().from(users);
      
      if (existingUsers.length === 0) {
        // Create a default user
        const bcrypt = await import('bcryptjs');
        const passwordHash = await bcrypt.hash('guest', 10);
        
        await db.insert(users).values({
          username: 'Guest',
          password: passwordHash,
          displayName: 'Guest User'
        });
        
        console.log('Created default user');
      }
    } catch (queryError) {
      console.warn('Error checking or creating default user:', queryError);
    }
  } catch (error) {
    console.warn('Failed to initialize default user (this is expected during deployment):', error);
    // Don't throw errors during deployment - this will be fixed when DATABASE_URL is provided
  }
}

// Create database storage instance
export const storage = new DatabaseStorage();

// Initialize the default user after a short delay to ensure the database connection is ready
// This ensures the app will still start even if database initialization fails
setTimeout(() => {
  initializeDefaultUser().catch(err => {
    console.warn('Default user initialization encountered an error:', err.message);
  });
}, 3000); // 3 second delay to ensure database is connected
