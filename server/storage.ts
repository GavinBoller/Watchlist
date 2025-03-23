import { 
  users, type User, type InsertUser,
  movies, type Movie, type InsertMovie,
  platforms, type Platform, type InsertPlatform,
  watchlistEntries, type WatchlistEntry, type InsertWatchlistEntry,
  type WatchlistEntryWithMovie
} from "@shared/schema";
import Database from 'better-sqlite3';
import { join } from 'path';
import fs from 'fs';
import { db } from "./db";
import { eq, and, ne } from "drizzle-orm";

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

  // Platform operations
  getPlatform(id: number): Promise<Platform | undefined>;
  getPlatforms(userId: number): Promise<Platform[]>;
  getDefaultPlatform(userId: number): Promise<Platform | undefined>;
  createPlatform(platform: InsertPlatform): Promise<Platform>;
  updatePlatform(id: number, updates: Partial<InsertPlatform>): Promise<Platform | undefined>;
  deletePlatform(id: number): Promise<boolean>;

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
        runtime INTEGER,
        mediaType TEXT,
        number_of_seasons INTEGER,
        number_of_episodes INTEGER
      )
    `);

    // Platforms table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS platforms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        name TEXT NOT NULL,
        logoUrl TEXT,
        isDefault INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Watchlist entries table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlist_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        movieId INTEGER NOT NULL,
        platformId INTEGER,
        watchedDate TEXT,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'to_watch',
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (movieId) REFERENCES movies(id) ON DELETE CASCADE,
        FOREIGN KEY (platformId) REFERENCES platforms(id) ON DELETE SET NULL
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
    
    // Add platformId column if it doesn't exist (for existing databases)
    try {
      const hasPlatformIdColumn = this.db.prepare("PRAGMA table_info(watchlist_entries)").all()
        .some((col: any) => col.name === 'platformId');
      
      if (!hasPlatformIdColumn) {
        this.db.exec("ALTER TABLE watchlist_entries ADD COLUMN platformId INTEGER REFERENCES platforms(id) ON DELETE SET NULL");
        console.log("Added platformId column to watchlist_entries table");
      }
    } catch (error) {
      console.error("Failed to check or add platformId column:", error);
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
        releaseDate, voteAverage, genres, runtime, mediaType,
        number_of_seasons, number_of_episodes
      ) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      insertMovie.runtime || null,
      insertMovie.mediaType || 'movie',
      insertMovie.numberOfSeasons || null,
      insertMovie.numberOfEpisodes || null
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
      runtime: insertMovie.runtime || null,
      mediaType: insertMovie.mediaType || 'movie',
      numberOfSeasons: insertMovie.numberOfSeasons || null,
      numberOfEpisodes: insertMovie.numberOfEpisodes || null
    };
  }

  // Platform operations
  async getPlatform(id: number): Promise<Platform | undefined> {
    const stmt = this.db.prepare('SELECT * FROM platforms WHERE id = ?');
    const platform = stmt.get(id) as Platform | undefined;
    return platform;
  }

  async getPlatforms(userId: number): Promise<Platform[]> {
    const stmt = this.db.prepare('SELECT * FROM platforms WHERE userId = ? ORDER BY name ASC');
    const platforms = stmt.all(userId) as Platform[];
    return platforms;
  }

  async getDefaultPlatform(userId: number): Promise<Platform | undefined> {
    const stmt = this.db.prepare('SELECT * FROM platforms WHERE userId = ? AND isDefault = 1 LIMIT 1');
    const platform = stmt.get(userId) as Platform | undefined;
    return platform;
  }

  async createPlatform(platform: InsertPlatform): Promise<Platform> {
    // If this is marked as default, unset any existing default platforms for this user
    if (platform.isDefault) {
      const unsetStmt = this.db.prepare('UPDATE platforms SET isDefault = 0 WHERE userId = ?');
      unsetStmt.run(platform.userId);
    }

    const stmt = this.db.prepare(`
      INSERT INTO platforms (userId, name, logoUrl, isDefault)
      VALUES (?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      platform.userId,
      platform.name,
      platform.logoUrl || null,
      platform.isDefault || false
    );
    
    return {
      id: Number(result.lastInsertRowid),
      userId: platform.userId,
      name: platform.name,
      logoUrl: platform.logoUrl || null,
      isDefault: platform.isDefault || false,
      createdAt: new Date()
    };
  }

  async updatePlatform(id: number, updates: Partial<InsertPlatform>): Promise<Platform | undefined> {
    // First, check if the platform exists
    const existingPlatform = await this.getPlatform(id);
    if (!existingPlatform) {
      return undefined;
    }
    
    // If this is being set as default, unset any existing default platforms for this user
    if (updates.isDefault) {
      const unsetStmt = this.db.prepare('UPDATE platforms SET isDefault = 0 WHERE userId = ?');
      unsetStmt.run(existingPlatform.userId);
    }
    
    // Build the SET clause dynamically based on provided updates
    const setClauses = [];
    const params = [];
    
    if (updates.name !== undefined) {
      setClauses.push('name = ?');
      params.push(updates.name);
    }
    
    if (updates.logoUrl !== undefined) {
      setClauses.push('logoUrl = ?');
      params.push(updates.logoUrl);
    }
    
    if (updates.isDefault !== undefined) {
      setClauses.push('isDefault = ?');
      params.push(updates.isDefault);
    }
    
    if (setClauses.length === 0) {
      // No updates provided
      return existingPlatform;
    }
    
    // Add the ID parameter
    params.push(id);
    
    // Execute the update
    const query = `
      UPDATE platforms 
      SET ${setClauses.join(', ')} 
      WHERE id = ?
    `;
    
    const stmt = this.db.prepare(query);
    stmt.run(...params);
    
    // Return the updated platform
    return {
      ...existingPlatform,
      ...updates,
      // Make sure to use the right field names
      name: updates.name !== undefined ? updates.name : existingPlatform.name,
      logoUrl: updates.logoUrl !== undefined ? updates.logoUrl : existingPlatform.logoUrl,
      isDefault: updates.isDefault !== undefined ? updates.isDefault : existingPlatform.isDefault
    };
  }

  async deletePlatform(id: number): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM platforms WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
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
        we.id, we.userId, we.movieId, we.platformId, we.watchedDate, we.notes, we.status, we.createdAt,
        m.id as movie_id, m.tmdbId, m.title, m.overview, m.posterPath, m.backdropPath, 
        m.releaseDate, m.voteAverage, m.genres, m.runtime, m.mediaType, m.number_of_seasons as numberOfSeasons, m.number_of_episodes as numberOfEpisodes,
        p.id as platform_id, p.name as platform_name, p.logoUrl as platform_logo, p.isDefault as platform_default,
        p.createdAt as platform_created
      FROM watchlist_entries we
      JOIN movies m ON we.movieId = m.id
      LEFT JOIN platforms p ON we.platformId = p.id
      WHERE we.userId = ?
    `);
    
    const results = stmt.all(userId) as any[];
    
    return results.map(row => {
      // Create the platform object if platform data exists
      let platform: Platform | null = null;
      if (row.platform_id) {
        platform = {
          id: row.platform_id,
          userId: userId,
          name: row.platform_name,
          logoUrl: row.platform_logo,
          isDefault: !!row.platform_default,
          createdAt: row.platform_created ? new Date(row.platform_created) : new Date()
        };
      }
      
      return {
        id: row.id,
        userId: row.userId,
        movieId: row.movieId,
        platformId: row.platformId,
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
          runtime: row.runtime || null,
          mediaType: row.mediaType,
          numberOfSeasons: row.numberOfSeasons || null,
          numberOfEpisodes: row.numberOfEpisodes || null
        },
        platform: platform
      };
    });
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
      INSERT INTO watchlist_entries (userId, movieId, platformId, watchedDate, notes, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run(
      insertEntry.userId,
      insertEntry.movieId,
      insertEntry.platformId || null,
      watchedDate,
      insertEntry.notes || null,
      insertEntry.status || 'to_watch'
    );
    
    return {
      id: Number(result.lastInsertRowid),
      userId: insertEntry.userId,
      movieId: insertEntry.movieId,
      platformId: insertEntry.platformId || null,
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
    
    if (updates.platformId !== undefined) {
      setClauses.push('platformId = ?');
      params.push(updates.platformId);
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
  private platforms: Map<number, Platform>;
  private watchlistEntries: Map<number, WatchlistEntry>;
  private userCurrentId: number;
  private movieCurrentId: number;
  private platformCurrentId: number;
  private watchlistEntryCurrentId: number;

  constructor() {
    this.users = new Map();
    this.movies = new Map();
    this.platforms = new Map();
    this.watchlistEntries = new Map();
    this.userCurrentId = 1;
    this.movieCurrentId = 1;
    this.platformCurrentId = 1;
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
      genres: insertMovie.genres || null,
      runtime: insertMovie.runtime || null,
      numberOfSeasons: insertMovie.numberOfSeasons || null,
      numberOfEpisodes: insertMovie.numberOfEpisodes || null
    };
    this.movies.set(id, movie);
    return movie;
  }

  // Platform operations
  async getPlatform(id: number): Promise<Platform | undefined> {
    return this.platforms.get(id);
  }

  async getPlatforms(userId: number): Promise<Platform[]> {
    return Array.from(this.platforms.values()).filter(
      (platform) => platform.userId === userId
    );
  }

  async getDefaultPlatform(userId: number): Promise<Platform | undefined> {
    return Array.from(this.platforms.values()).find(
      (platform) => platform.userId === userId && platform.isDefault
    );
  }

  async createPlatform(platform: InsertPlatform): Promise<Platform> {
    // If this is marked as default, unset any existing default platforms for this user
    if (platform.isDefault) {
      this.platforms.forEach((existingPlatform) => {
        if (existingPlatform.userId === platform.userId && existingPlatform.isDefault) {
          existingPlatform.isDefault = false;
        }
      });
    }

    const id = this.platformCurrentId++;
    const newPlatform: Platform = {
      id,
      userId: platform.userId,
      name: platform.name,
      logoUrl: platform.logoUrl || null,
      isDefault: platform.isDefault || false,
      createdAt: new Date()
    };

    this.platforms.set(id, newPlatform);
    return newPlatform;
  }

  async updatePlatform(id: number, updates: Partial<InsertPlatform>): Promise<Platform | undefined> {
    const platform = this.platforms.get(id);
    if (!platform) return undefined;

    // If this is being set as default, unset any existing default platforms for this user
    if (updates.isDefault) {
      this.platforms.forEach((existingPlatform) => {
        if (existingPlatform.userId === platform.userId && existingPlatform.isDefault && existingPlatform.id !== id) {
          existingPlatform.isDefault = false;
        }
      });
    }

    const updatedPlatform: Platform = {
      ...platform,
      name: updates.name !== undefined ? updates.name : platform.name,
      logoUrl: updates.logoUrl !== undefined ? updates.logoUrl : platform.logoUrl,
      isDefault: updates.isDefault !== undefined ? updates.isDefault : platform.isDefault
    };

    this.platforms.set(id, updatedPlatform);
    return updatedPlatform;
  }

  async deletePlatform(id: number): Promise<boolean> {
    return this.platforms.delete(id);
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
      platformId: insertEntry.platformId || null,
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

import { executeDirectSql } from './db';


// DatabaseStorage implementation for PostgreSQL
export class DatabaseStorage implements IStorage {
  // Emergency fallback memory storage for complete database failures
  private emergencyMemoryStorage: MemStorage | null = null;
  
  // Platform operations
  async getPlatform(id: number): Promise<Platform | undefined> {
    try {
      const [platform] = await db.select().from(platforms).where(eq(platforms.id, id));
      return platform || undefined;
    } catch (error) {
      console.error("Database error in getPlatform:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          const rows = await executeDirectSql<Platform>(
            'SELECT * FROM "platforms" WHERE "id" = $1 LIMIT 1',
            [id],
            'Failed to retrieve platform'
          );
          return rows[0] || undefined;
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for getPlatform:", fallbackError);
          return undefined;
        }
      }
      
      return undefined;
    }
  }

  async getPlatforms(userId: number): Promise<Platform[]> {
    try {
      return await db.select().from(platforms).where(eq(platforms.userId, userId));
    } catch (error) {
      console.error("Database error in getPlatforms:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          return await executeDirectSql<Platform>(
            'SELECT * FROM "platforms" WHERE "userId" = $1',
            [userId],
            'Failed to retrieve platforms'
          );
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for getPlatforms:", fallbackError);
          return [];
        }
      }
      
      return [];
    }
  }

  async getDefaultPlatform(userId: number): Promise<Platform | undefined> {
    try {
      const [platform] = await db
        .select()
        .from(platforms)
        .where(and(eq(platforms.userId, userId), eq(platforms.isDefault, true)));
      return platform || undefined;
    } catch (error) {
      console.error("Database error in getDefaultPlatform:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          const rows = await executeDirectSql<Platform>(
            'SELECT * FROM "platforms" WHERE "userId" = $1 AND "isDefault" = TRUE LIMIT 1',
            [userId],
            'Failed to retrieve default platform'
          );
          return rows[0] || undefined;
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for getDefaultPlatform:", fallbackError);
          return undefined;
        }
      }
      
      return undefined;
    }
  }

  async createPlatform(platform: InsertPlatform): Promise<Platform> {
    try {
      // If this is set as default, unset any existing default platforms for this user
      if (platform.isDefault) {
        try {
          await db
            .update(platforms)
            .set({ isDefault: false })
            .where(and(eq(platforms.userId, platform.userId), eq(platforms.isDefault, true)));
        } catch (updateError) {
          console.error("Failed to update existing default platforms:", updateError);
          
          if (this.shouldUseDirectSqlFallback(updateError)) {
            await executeDirectSql(
              'UPDATE "platforms" SET "isDefault" = FALSE WHERE "userId" = $1 AND "isDefault" = TRUE',
              [platform.userId],
              'Failed to update existing default platforms'
            );
          }
        }
      }
      
      // Create the new platform
      const [newPlatform] = await db.insert(platforms).values(platform).returning();
      return newPlatform;
    } catch (error) {
      console.error("Database error in createPlatform:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          // If this is set as default, unset any existing default platforms for this user
          if (platform.isDefault) {
            await executeDirectSql(
              'UPDATE "platforms" SET "isDefault" = FALSE WHERE "userId" = $1 AND "isDefault" = TRUE',
              [platform.userId],
              'Failed to update existing default platforms'
            );
          }
          
          const rows = await executeDirectSql<Platform>(
            'INSERT INTO "platforms" ("userId", "name", "logoUrl", "isDefault") VALUES ($1, $2, $3, $4) RETURNING *',
            [platform.userId, platform.name, platform.logoUrl || null, platform.isDefault || false],
            'Failed to create platform'
          );
          
          if (rows.length === 0) {
            throw new Error('Platform creation did not return any data');
          }
          
          return rows[0];
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for createPlatform:", fallbackError);
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }

  async updatePlatform(id: number, updates: Partial<InsertPlatform>): Promise<Platform | undefined> {
    try {
      // Get the existing platform first
      const existingPlatform = await this.getPlatform(id);
      if (!existingPlatform) {
        return undefined;
      }
      
      // If this is being set as default, unset any existing default platforms for this user
      if (updates.isDefault) {
        try {
          await db
            .update(platforms)
            .set({ isDefault: false })
            .where(
              and(
                eq(platforms.userId, existingPlatform.userId),
                eq(platforms.isDefault, true),
                ne(platforms.id, id)
              )
            );
        } catch (updateError) {
          console.error("Failed to update existing default platforms:", updateError);
          
          if (this.shouldUseDirectSqlFallback(updateError)) {
            await executeDirectSql(
              'UPDATE "platforms" SET "isDefault" = FALSE WHERE "userId" = $1 AND "isDefault" = TRUE AND "id" != $2',
              [existingPlatform.userId, id],
              'Failed to update existing default platforms'
            );
          }
        }
      }
      
      // Update the platform
      const [updatedPlatform] = await db
        .update(platforms)
        .set(updates)
        .where(eq(platforms.id, id))
        .returning();
      
      return updatedPlatform;
    } catch (error) {
      console.error("Database error in updatePlatform:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          // Get the existing platform first
          const existingPlatform = await this.getPlatform(id);
          if (!existingPlatform) {
            return undefined;
          }
          
          // If this is being set as default, unset any existing default platforms for this user
          if (updates.isDefault) {
            await executeDirectSql(
              'UPDATE "platforms" SET "isDefault" = FALSE WHERE "userId" = $1 AND "isDefault" = TRUE AND "id" != $2',
              [existingPlatform.userId, id],
              'Failed to update existing default platforms'
            );
          }
          
          // Build the SET clause dynamically
          const setClauses = [];
          const params = [];
          
          if (updates.name !== undefined) {
            setClauses.push('"name" = $' + (params.length + 1));
            params.push(updates.name);
          }
          
          if (updates.logoUrl !== undefined) {
            setClauses.push('"logoUrl" = $' + (params.length + 1));
            params.push(updates.logoUrl);
          }
          
          if (updates.isDefault !== undefined) {
            setClauses.push('"isDefault" = $' + (params.length + 1));
            params.push(updates.isDefault);
          }
          
          if (setClauses.length === 0) {
            return existingPlatform;
          }
          
          // Add the ID parameter
          params.push(id);
          
          const rows = await executeDirectSql<Platform>(
            `UPDATE "platforms" SET ${setClauses.join(', ')} WHERE "id" = $${params.length} RETURNING *`,
            params,
            'Failed to update platform'
          );
          
          return rows[0] || undefined;
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for updatePlatform:", fallbackError);
          return undefined;
        }
      }
      
      return undefined;
    }
  }

  async deletePlatform(id: number): Promise<boolean> {
    try {
      // First, we should reset any watchlist entries that use this platform
      try {
        await db.update(watchlistEntries)
          .set({ platformId: null })
          .where(eq(watchlistEntries.platformId, id));
        console.log(`[STORAGE] Reset platformId to null for watchlist entries using platform ${id}`);
      } catch (updateError) {
        console.warn(`[STORAGE] Error resetting platformId for watchlist entries: ${updateError}`);
        // Continue with deletion even if this fails
      }
      
      // Now delete the platform
      const result = await db.delete(platforms).where(eq(platforms.id, id));
      console.log(`[STORAGE] Successfully deleted platform ${id}`);
      return true;
    } catch (error) {
      console.error("Database error in deletePlatform:", error);
      
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          // First reset platformId in watchlist entries
          try {
            await executeDirectSql(
              'UPDATE "watchlist_entries" SET "platform_id" = NULL WHERE "platform_id" = $1',
              [id],
              'Failed to reset platform references'
            );
          } catch (resetError) {
            console.warn(`[STORAGE] Direct SQL fallback failed for resetting platformId: ${resetError}`);
            // Continue with deletion even if this fails
          }
          
          // Now delete the platform
          await executeDirectSql(
            'DELETE FROM "platforms" WHERE "id" = $1',
            [id],
            'Failed to delete platform'
          );
          console.log(`[STORAGE] Successfully deleted platform ${id} using direct SQL`);
          return true;
        } catch (fallbackError) {
          console.error("Direct SQL fallback failed for deletePlatform:", fallbackError);
          return false;
        }
      }
      
      return false;
    }
  }
  /**
   * Direct SQL query method for emergency operations
   * This provides a bypass when ORM operations are failing
   * Only use this for critical operations when normal paths fail
   */
  
  // CRITICAL FIX FOR PRODUCTION: Track successful session IDs to help
  // recover sessions that might become corrupted
  private static knownGoodSessions = new Map<string, {
    userId: number;
    username: string;
    timestamp: number;
  }>();
  
  // Track database connection recovery attempts
  private isRecoveringConnection = false;
  private connectionRecoveryAttempts = 0;
  private lastConnectionRecoveryTime = 0;
  
  // Track success metrics to help diagnose issues
  private lastSuccessfulOperation = Date.now();
  private consecutiveErrors = 0;
  private isInDatabaseFailureMode = false;
  async directSqlQuery<T = any>(
    sql: string, 
    params: any[] = [],
    errorMessage: string = 'Emergency SQL query failed'
  ): Promise<T[]> {
    try {
      console.log(`[STORAGE] Executing emergency direct SQL query: ${sql.substring(0, 100)}...`);
      return await executeDirectSql<T>(sql, params, errorMessage);
    } catch (sqlError) {
      console.error(`[STORAGE] Emergency SQL query failed:`, sqlError);
      throw sqlError;
    }
  }

  /**
   * Helper method to determine if we should use direct SQL as fallback
   * This is useful when ORM operations may fail due to connection issues
   * In production, we're more aggressive with fallbacks to improve reliability
   */
  /**
   * Check database connection and attempt recovery if needed
   * This method provides a reliable way to verify database connection
   * before critical operations
   */
  private async checkDatabaseConnection(): Promise<boolean> {
    try {
      // Skip if already in recovery mode to prevent cascading calls
      if (this.isRecoveringConnection) {
        return false;
      }
      
      this.isRecoveringConnection = true;
      console.log('[STORAGE] Checking database connection status');
      
      // Import the connection check function dynamically to avoid import cycles
      const { ensureDatabaseReady } = await import('./db');
      const isConnected = await ensureDatabaseReady();
      
      if (isConnected) {
        // Reset error counters on success
        this.connectionRecoveryAttempts = 0;
        this.lastSuccessfulOperation = Date.now();
        this.consecutiveErrors = 0;
        this.isInDatabaseFailureMode = false;
        console.log('[STORAGE] Database connection verified successfully');
      } else {
        this.connectionRecoveryAttempts++;
        this.isInDatabaseFailureMode = true;
        console.error(`[STORAGE] Database connection check failed (attempt ${this.connectionRecoveryAttempts})`);
      }
      
      this.isRecoveringConnection = false;
      this.lastConnectionRecoveryTime = Date.now();
      
      return isConnected;
    } catch (error) {
      console.error('[STORAGE] Error during database connection check:', error);
      this.isRecoveringConnection = false;
      this.isInDatabaseFailureMode = true;
      return false;
    }
  }

  private shouldUseDirectSqlFallback(error: unknown): boolean {
    if (!error) return false;
    
    // In production, be more aggressive with fallbacks
    const isProd = process.env.NODE_ENV === 'production';
    
    // Track consecutive errors to help diagnose systemic issues
    this.consecutiveErrors++;
    
    // Log the error details to help with debugging
    if (error instanceof Error) {
      console.error(`[STORAGE] Error type: ${error.name}, Message: ${error.message}`);
    } else {
      console.error(`[STORAGE] Non-Error object: ${String(error)}`);
    }
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Common database connection/disruption error patterns
    const isConnectionError = 
      errorMessage.includes('connection') || 
      errorMessage.includes('timeout') || 
      errorMessage.includes('ECONNREFUSED') || 
      errorMessage.includes('terminated') ||
      errorMessage.includes('unexpected') ||
      errorMessage.includes('network') ||
      errorMessage.includes('closed') || 
      errorMessage.includes('ended') ||
      errorMessage.includes('not connected');
    
    // Common ORM-specific errors
    const isOrmError =
      errorMessage.includes('relation') ||
      errorMessage.includes('driver') ||
      errorMessage.includes('pool') ||
      errorMessage.includes('SQLError');
      
    // In production, we're more liberal with fallbacks to improve reliability
    return isConnectionError || (isProd && isOrmError);
  }
  
  async getUser(id: number): Promise<User | undefined> {
    try {
      // Add detailed logging for session debugging
      console.log(`[DB] Looking up user with ID: ${id}`);
      
      // First attempt with Drizzle ORM
      const [user] = await db.select().from(users).where(eq(users.id, id));
      
      if (user) {
        console.log(`[DB] Found user: ${user.username} (ID: ${user.id})`);
      } else {
        console.log(`[DB] No user found with ID: ${id}`);
      }
      
      return user || undefined;
    } catch (error) {
      console.error("Database error in getUser using ORM:", error);
      
      // Enhanced error logging for authentication debugging
      if (error instanceof Error) {
        console.error(`[DB] Error type: ${error.name}, Message: ${error.message}`);
        console.error(`[DB] Stack trace: ${error.stack}`);
      }
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getUser");
          const rows = await executeDirectSql<User>(
            'SELECT * FROM "users" WHERE "id" = $1 LIMIT 1',
            [id],
            'Failed to retrieve user'
          );
          
          if (rows && rows.length > 0) {
            console.log(`[DB] Found user via SQL fallback: ${rows[0].username} (ID: ${rows[0].id})`);
            return rows[0];
          } else {
            console.log(`[DB] No user found via SQL fallback for ID: ${id}`);
            return undefined;
          }
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return undefined instead of throwing an error
          // This makes session handling more reliable by avoiding disruptive exceptions
          console.log("Returning undefined instead of throwing error for user lookup");
          return undefined;
        }
      }
      
      // For non-connection errors, also return undefined rather than throwing
      // This prevents session validation from breaking the entire application
      console.log("Returning undefined due to database error for user lookup");
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      // Add detailed logging for authentication debugging
      console.log(`[DB] Looking up user by username: ${username}`);
      
      // First attempt with Drizzle ORM
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username));
      
      if (user) {
        console.log(`[DB] Found user by username: ${user.username} (ID: ${user.id})`);
      } else {
        console.log(`[DB] No user found with username: ${username}`);
      }
      
      return user || undefined;
    } catch (error) {
      console.error("Database error in getUserByUsername using ORM:", error);
      
      // Enhanced error logging for authentication debugging
      if (error instanceof Error) {
        console.error(`[DB] Error type: ${error.name}, Message: ${error.message}`);
        console.error(`[DB] Stack trace: ${error.stack}`);
      }
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getUserByUsername");
          const rows = await executeDirectSql<User>(
            'SELECT * FROM "users" WHERE "username" = $1 LIMIT 1',
            [username],
            'Failed to retrieve user by username'
          );
          
          if (rows && rows.length > 0) {
            console.log(`[DB] Found user via SQL fallback: ${rows[0].username} (ID: ${rows[0].id})`);
            return rows[0];
          } else {
            console.log(`[DB] No user found via SQL fallback for username: ${username}`);
            return undefined;
          }
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return undefined instead of throwing error
          console.log("Returning undefined instead of throwing error for username lookup");
          return undefined;
        }
      }
      
      // For non-connection errors, also return undefined
      console.log("Returning undefined due to database error for username lookup");
      return undefined;
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    console.log(`[STORAGE] Creating user with username: ${insertUser.username}`);
    
    try {
      // Use our enhanced connection verification method
      console.log(`[STORAGE] Verifying database connection before user creation`);
      const isConnected = await this.checkDatabaseConnection();
      
      if (!isConnected) {
        console.warn(`[STORAGE] Database connection verification failed, proceeding with caution`);
        
        // Add special handling for production database outages
        if (process.env.NODE_ENV === 'production') {
          console.log(`[STORAGE] PRODUCTION ENVIRONMENT: Using emergency memory storage mode`);
          
          // Create a memory storage instance for this emergency
          if (!this.emergencyMemoryStorage) {
            console.log(`[STORAGE] Initializing emergency memory storage system`);
            this.emergencyMemoryStorage = new MemStorage();
          }
          
          try {
            // Try to create the user in memory storage
            console.log(`[STORAGE] Creating user in emergency memory storage: ${insertUser.username}`);
            const memUser = await this.emergencyMemoryStorage.createUser(insertUser);
            console.log(`[STORAGE] User created in memory storage: ${memUser.id}`);
            return memUser;
          } catch (memError) {
            console.error(`[STORAGE] Failed to create user in memory storage:`, memError);
            // Continue with normal flow if memory storage fails
          }
        }
      } else {
        console.log(`[STORAGE] Database connection verified`);
      }
      
      // Check if db is defined before attempting to use it
      if (!db) {
        console.error(`[STORAGE] Drizzle ORM not initialized, falling back to direct SQL`);
        // Print all available environment variables (excluding secrets)
        console.log(`[STORAGE] Environment variables:`, 
          Object.keys(process.env)
            .filter(k => !k.includes('SECRET') && !k.includes('KEY'))
            .join(', ')
        );
        throw new Error('ORM not initialized');
      }
      
      // Attempt with Drizzle ORM
      console.log(`[STORAGE] Attempting to create user with Drizzle ORM`);
      const [user] = await db
        .insert(users)
        .values(insertUser)
        .returning();
      
      console.log(`[STORAGE] User created successfully with Drizzle ORM: ${user.id}`);
      return user;
    } catch (error) {
      console.error("[STORAGE] Database error in createUser using ORM:", error);
      
      // Enhanced error logging for debugging
      if (error instanceof Error) {
        console.error(`[STORAGE] Error type: ${error.name}`);
        console.error(`[STORAGE] Error message: ${error.message}`);
        console.error(`[STORAGE] Error stack: ${error.stack}`);
      }
      
      // Check for common error types
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        console.log(`[STORAGE] Detected duplicate username: ${insertUser.username}`);
        throw new Error('Username already exists');
      }
      
      // Always try direct SQL as fallback in production
      const isProd = process.env.NODE_ENV === 'production';
      const shouldFallback = isProd || this.shouldUseDirectSqlFallback(error);
      
      if (shouldFallback) {
        try {
          console.log(`[STORAGE] Attempting direct SQL fallback for user creation: ${insertUser.username}`);
          
          // Direct SQL insertion with proper value escaping for better reliability
          // Explicitly name columns for better cross-environment compatibility
          const safeInsertData = {
            username: insertUser.username,
            password: insertUser.password,
            display_name: insertUser.displayName || insertUser.username
          };
          
          const columns = Object.keys(safeInsertData).map(key => `"${key}"`).join(', ');
          const placeholders = Object.keys(safeInsertData).map((_, index) => `$${index + 1}`).join(', ');
          const values = Object.values(safeInsertData);
          
          console.log(`[STORAGE] Direct SQL insert with columns: ${columns}`);
          console.log(`[STORAGE] SQL values count: ${values.length}`);
          
          // Robust error handling for the SQL fallback
          try {
            const rows = await executeDirectSql<User>(
              `INSERT INTO "users" (${columns}) VALUES (${placeholders}) RETURNING *`,
              values,
              'Failed to create user'
            );
            
            if (rows.length === 0) {
              console.error(`[STORAGE] User creation did not return data`);
              throw new Error('User creation did not return any data');
            }
            
            console.log(`[STORAGE] User created successfully with direct SQL: ${rows[0].id}`);
            return rows[0];
          } catch (sqlError) {
            console.error("[STORAGE] Direct SQL execution error:", sqlError);
            throw sqlError;
          }
        } catch (fallbackError) {
          console.error("[STORAGE] Direct SQL fallback failed:", fallbackError);
          
          // Enhanced diagnosis
          if (fallbackError instanceof Error) {
            console.error(`[STORAGE] Fallback error name: ${fallbackError.name}`);
            console.error(`[STORAGE] Fallback error message: ${fallbackError.message}`);
            
            const fallbackMessage = fallbackError.message;
            if (fallbackMessage.includes('duplicate key') || fallbackMessage.includes('unique constraint')) {
              throw new Error('Username already exists');
            }
            
            if (fallbackMessage.includes('connection') || fallbackMessage.includes('timeout')) {
              throw new Error('Database connection issue. Please try again in a few moments.');
            }
          }
          
          throw new Error(`Registration failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown database error'}`);
        }
      }
      
      if (errorMessage.includes('connection') || errorMessage.includes('timeout')) {
        throw new Error('Database connection issue. Please try again later.');
      }
      
      throw new Error(`Failed to create user: ${errorMessage}`);
    }
  }

  async getAllUsers(): Promise<User[]> {
    try {
      const userList = await db.select().from(users);
      return userList || [];
    } catch (error) {
      console.error("Database error in getAllUsers using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getAllUsers");
          const result = await executeDirectSql<User>(
            'SELECT * FROM "users"',
            [],
            'Failed to retrieve users'
          );
          return result || [];
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return empty array instead of throwing error
          console.log("Returning empty array instead of throwing error for users lookup");
          return [];
        }
      }
      
      // For non-connection errors, also return empty array
      console.log("Returning empty array due to database error for users lookup");
      return [];
    }
  }
  
  async updateUser(id: number, updates: Partial<InsertUser>): Promise<User | undefined> {
    try {
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
    } catch (error) {
      console.error("Database error in updateUser using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for updateUser");
          
          // Build SET clause for SQL update
          const setClause = Object.entries(updates)
            .map(([key, _], index) => `"${key}" = $${index + 2}`)
            .join(', ');
          
          const params = [id, ...Object.values(updates)];
          
          const rows = await executeDirectSql<User>(
            `UPDATE "users" SET ${setClause} WHERE "id" = $1 RETURNING *`,
            params,
            'Failed to update user'
          );
          
          if (rows.length === 0) {
            return undefined;
          }
          
          return rows[0];
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          throw fallbackError;
        }
      }
      
      throw new Error(`Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getMovie(id: number): Promise<Movie | undefined> {
    try {
      // Try with ORM first
      const [movie] = await db.select().from(movies).where(eq(movies.id, id));
      return movie || undefined;
    } catch (error) {
      console.error("Database error in getMovie using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getMovie");
          const rows = await executeDirectSql<Movie>(
            'SELECT * FROM "movies" WHERE "id" = $1 LIMIT 1',
            [id],
            'Failed to retrieve movie by ID'
          );
          return rows[0] || undefined;
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return undefined instead of throwing an error
          return undefined;
        }
      }
      
      // Return undefined for any other error instead of throwing
      return undefined;
    }
  }

  async getMovieByTmdbId(tmdbId: number): Promise<Movie | undefined> {
    try {
      // Try with ORM first
      const [movie] = await db.select().from(movies).where(eq(movies.tmdbId, tmdbId));
      return movie || undefined;
    } catch (error) {
      console.error("Database error in getMovieByTmdbId using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getMovieByTmdbId");
          const rows = await executeDirectSql<Movie>(
            'SELECT * FROM "movies" WHERE "tmdbId" = $1 LIMIT 1',
            [tmdbId],
            'Failed to retrieve movie by TMDB ID'
          );
          return rows[0] || undefined; // Return undefined if no movie found
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return undefined instead of throwing an error
          return undefined;
        }
      }
      
      // Return undefined for any other error instead of throwing
      return undefined;
    }
  }

  async createMovie(insertMovie: InsertMovie): Promise<Movie> {
    try {
      // First try ORM approach
      const [movie] = await db
        .insert(movies)
        .values(insertMovie)
        .returning();
      return movie;
    } catch (error) {
      console.error("Database error in createMovie using ORM:", error);
      
      // Check for common error types
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        // Try to fetch existing movie instead of failing
        try {
          const existingMovie = await this.getMovieByTmdbId(insertMovie.tmdbId);
          if (existingMovie) {
            console.log(`Movie with tmdbId ${insertMovie.tmdbId} already exists, returning existing record`);
            return existingMovie;
          }
        } catch (fetchError) {
          console.error("Error fetching existing movie:", fetchError);
        }
      }
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for createMovie");
          
          // Check if movie already exists with this tmdbId
          const existingRows = await executeDirectSql<Movie>(
            'SELECT * FROM "movies" WHERE "tmdbId" = $1 LIMIT 1',
            [insertMovie.tmdbId],
            'Failed to check for existing movie'
          );
          
          if (existingRows.length > 0) {
            return existingRows[0];
          }
          
          // Direct SQL insertion with proper value escaping
          const columns = Object.keys(insertMovie).map(key => `"${key}"`).join(', ');
          const placeholders = Object.keys(insertMovie).map((_, index) => `$${index + 1}`).join(', ');
          const values = Object.values(insertMovie);
          
          const rows = await executeDirectSql<Movie>(
            `INSERT INTO "movies" (${columns}) VALUES (${placeholders}) RETURNING *`,
            values,
            'Failed to create movie'
          );
          
          if (rows.length === 0) {
            throw new Error('Movie creation did not return any data');
          }
          
          return rows[0];
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          
          // One last attempt to check if movie exists (might have been created in a race condition)
          try {
            const lastChanceCheck = await executeDirectSql<Movie>(
              'SELECT * FROM "movies" WHERE "tmdbId" = $1 LIMIT 1',
              [insertMovie.tmdbId],
              'Failed to check for existing movie'
            );
            
            if (lastChanceCheck.length > 0) {
              return lastChanceCheck[0];
            }
          } catch (e) {
            // Ignore this error and proceed with the original error
          }
          
          throw fallbackError;
        }
      }
      
      throw new Error(`Failed to create movie: ${errorMessage}`);
    }
  }

  async getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined> {
    try {
      // Try using ORM first
      const [entry] = await db.select().from(watchlistEntries).where(eq(watchlistEntries.id, id));
      return entry || undefined;
    } catch (error) {
      console.error("Database error in getWatchlistEntry using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getWatchlistEntry");
          const rows = await executeDirectSql<WatchlistEntry>(
            'SELECT * FROM "watchlist_entries" WHERE "id" = $1 LIMIT 1',
            [id],
            'Failed to retrieve watchlist entry'
          );
          return rows[0] || undefined;
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return undefined instead of throwing an error
          return undefined;
        }
      }
      
      // Return undefined for any other error instead of throwing
      return undefined;
    }
  }

  async getWatchlistEntries(userId: number): Promise<WatchlistEntryWithMovie[]> {
    try {
      // Get watchlist entries for this user
      const entries = await db
        .select()
        .from(watchlistEntries)
        .where(eq(watchlistEntries.userId, userId));
      
      const result: WatchlistEntryWithMovie[] = [];
      
      // Load movie data and platform data for each entry
      for (const entry of entries) {
        try {
          const [movie] = await db.select().from(movies).where(eq(movies.id, entry.movieId));
          
          // Get platform data if platformId exists
          let platform = undefined;
          if (entry.platformId) {
            try {
              const [platformData] = await db.select().from(platforms).where(eq(platforms.id, entry.platformId));
              platform = platformData;
            } catch (platformError) {
              console.error(`Error fetching platform ${entry.platformId} for watchlist entry ${entry.id}:`, platformError);
              // Continue without platform data rather than failing
            }
          }
          
          if (movie) {
            result.push({
              ...entry,
              movie,
              platform
            });
          }
        } catch (movieError) {
          console.error(`Error fetching movie ${entry.movieId} for watchlist entry ${entry.id}:`, movieError);
          // Try direct SQL as fallback for movie lookup
          try {
            const movies = await executeDirectSql<Movie>(
              'SELECT * FROM "movies" WHERE "id" = $1 LIMIT 1',
              [entry.movieId],
              'Failed to retrieve movie for watchlist entry'
            );
            
            // Get platform data if platformId exists
            let platform = undefined;
            if (entry.platformId) {
              try {
                const platforms = await executeDirectSql<Platform>(
                  'SELECT * FROM "platforms" WHERE "id" = $1 LIMIT 1',
                  [entry.platformId],
                  'Failed to retrieve platform for watchlist entry'
                );
                if (platforms.length > 0) {
                  platform = platforms[0];
                }
              } catch (platformError) {
                console.error(`Failed to fetch platform ${entry.platformId} for watchlist entry ${entry.id}:`, platformError);
                // Continue without platform data rather than failing
              }
            }
            
            if (movies.length > 0) {
              result.push({
                ...entry,
                movie: movies[0],
                platform
              });
            }
          } catch (fallbackError) {
            console.error("Failed to fetch movie using fallback:", fallbackError);
            // Skip this entry rather than failing the entire operation
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error("Database error in getWatchlistEntries using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for getWatchlistEntries");
          // Get entries
          const entries = await executeDirectSql<WatchlistEntry>(
            'SELECT * FROM "watchlist_entries" WHERE "userId" = $1',
            [userId],
            'Failed to retrieve watchlist entries'
          );
          
          const result: WatchlistEntryWithMovie[] = [];
          
          // Load movie data and platform data for each entry
          for (const entry of entries) {
            try {
              const movies = await executeDirectSql<Movie>(
                'SELECT * FROM "movies" WHERE "id" = $1 LIMIT 1',
                [entry.movieId],
                'Failed to retrieve movie for watchlist entry'
              );
              
              // Get platform data if platformId exists
              let platform = undefined;
              if (entry.platformId) {
                try {
                  const platforms = await executeDirectSql<Platform>(
                    'SELECT * FROM "platforms" WHERE "id" = $1 LIMIT 1',
                    [entry.platformId],
                    'Failed to retrieve platform for watchlist entry'
                  );
                  if (platforms.length > 0) {
                    platform = platforms[0];
                  }
                } catch (platformError) {
                  console.error(`Failed to fetch platform ${entry.platformId} for watchlist entry ${entry.id}:`, platformError);
                  // Continue without platform data rather than failing
                }
              }
              
              if (movies.length > 0) {
                result.push({
                  ...entry,
                  movie: movies[0],
                  platform
                });
              }
            } catch (movieError) {
              console.error(`Failed to fetch movie ${entry.movieId} for watchlist entry ${entry.id}:`, movieError);
              // Skip this entry rather than failing the entire operation
            }
          }
          
          return result;
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return empty array instead of throwing an error
          return [];
        }
      }
      
      // Return empty array for any other error instead of throwing
      return [];
    }
  }

  async hasWatchlistEntry(userId: number, movieId: number): Promise<boolean> {
    // Environment detection for better error handling
    const isProd = process.env.NODE_ENV === 'production';
    
    try {
      console.log(`[DB] Checking if entry already exists for user ${userId} and movie ${movieId}`);
      
      // Try using ORM first with additional logging for production issues
      const entries = await db
        .select()
        .from(watchlistEntries)
        .where(
          and(
            eq(watchlistEntries.userId, userId),
            eq(watchlistEntries.movieId, movieId)
          )
        );
      
      const hasEntry = entries.length > 0;
      console.log(`[DB] Entry exists check result: ${hasEntry}`);
      return hasEntry;
    } catch (error) {
      // Enhanced error logging, particularly for production
      if (isProd) {
        console.error('Production database error checking watchlist entry:', {
          error: error instanceof Error ? error.message : String(error),
          userId,
          movieId,
          time: new Date().toISOString(),
          errorCode: error instanceof Error && 'code' in error ? (error as any).code : 'unknown'
        });
      } else {
        console.error("Database error in hasWatchlistEntry using ORM:", error);
      }
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log(`[DB] Attempting direct SQL fallback for watchlist entry check`);
          const rows = await executeDirectSql<{count: number}>(
            'SELECT COUNT(*) as count FROM "watchlist_entries" WHERE "userId" = $1 AND "movieId" = $2',
            [userId, movieId],
            'Failed to check watchlist entry existence'
          );
          
          if (rows.length > 0) {
            const hasEntry = rows[0].count > 0;
            console.log(`[DB] Direct SQL fallback successful, entry exists: ${hasEntry}`);
            return hasEntry;
          }
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          
          // In production, provide more detailed logging
          if (isProd) {
            console.error('Production direct SQL fallback error:', {
              error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              userId,
              movieId,
              time: new Date().toISOString()
            });
          }
          
          // Return false instead of throwing an error, as this is a check operation
          return false;
        }
      }
      
      // Return false for any error rather than throwing
      // This won't break watchlist operations - better UX
      console.log('[DB] Defaulting to false for watchlist entry check to ensure smooth operation');
      return false;
    }
  }

  async createWatchlistEntry(insertEntry: InsertWatchlistEntry): Promise<WatchlistEntry> {
    console.log(`[DB] Creating watchlist entry for user ${insertEntry.userId} and movie ${insertEntry.movieId}`);
    
    try {
      // First check if entry already exists
      console.log(`[DB] Checking if entry already exists`);
      const exists = await this.hasWatchlistEntry(
        insertEntry.userId, 
        insertEntry.movieId
      );
      
      if (exists) {
        console.log(`[DB] Watchlist entry already exists for user ${insertEntry.userId} and movie ${insertEntry.movieId}`);
        // Get the existing entry
        const entries = await db
          .select()
          .from(watchlistEntries)
          .where(
            and(
              eq(watchlistEntries.userId, insertEntry.userId),
              eq(watchlistEntries.movieId, insertEntry.movieId)
            )
          );
        
        if (entries.length > 0) {
          console.log(`[DB] Returning existing entry:`, JSON.stringify(entries[0]));
          return entries[0];
        }
      }
      
      // Create new entry using ORM
      console.log(`[DB] Creating new watchlist entry using ORM:`, JSON.stringify(insertEntry));
      const [entry] = await db
        .insert(watchlistEntries)
        .values(insertEntry)
        .returning();
      
      console.log(`[DB] Successfully created watchlist entry with ID ${entry.id}`);
      return entry;
    } catch (error) {
      console.error(`[DB] Database error in createWatchlistEntry using ORM:`, error);
      
      // Check for common error types
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error(`[DB] Error details:`, errorMessage);
      console.error(`[DB] Error stack:`, errorStack);
      
      // Log environment info for debugging production vs development differences
      console.log(`[DB] Environment: ${process.env.NODE_ENV || 'development'}`);
      
      if (errorMessage.includes('duplicate key') || errorMessage.includes('unique constraint')) {
        console.log(`[DB] Detected duplicate key error, trying to fetch existing entry`);
        // Try to fetch existing entry instead of failing
        try {
          const entries = await db
            .select()
            .from(watchlistEntries)
            .where(
              and(
                eq(watchlistEntries.userId, insertEntry.userId),
                eq(watchlistEntries.movieId, insertEntry.movieId)
              )
            );
          
          if (entries.length > 0) {
            console.log(`[DB] Found existing entry, returning`, JSON.stringify(entries[0]));
            return entries[0];
          }
        } catch (fetchError) {
          console.error(`[DB] Error fetching existing watchlist entry:`, fetchError);
        }
      }
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        console.log(`[DB] Attempting direct SQL fallback due to connection issues`);
        try {
          console.log(`[DB] Checking if entry already exists via direct SQL`);
          
          // Check if entry already exists
          const existingRows = await executeDirectSql<WatchlistEntry>(
            'SELECT * FROM "watchlist_entries" WHERE "userId" = $1 AND "movieId" = $2 LIMIT 1',
            [insertEntry.userId, insertEntry.movieId],
            'Failed to check for existing watchlist entry'
          );
          
          if (existingRows.length > 0) {
            console.log(`[DB] Found existing entry via direct SQL, returning`, JSON.stringify(existingRows[0]));
            return existingRows[0];
          }
          
          // Direct SQL insertion with proper value escaping
          console.log(`[DB] Inserting new entry via direct SQL`);
          const columns = Object.keys(insertEntry).map(key => `"${key}"`).join(', ');
          const placeholders = Object.keys(insertEntry).map((_, index) => `$${index + 1}`).join(', ');
          const values = Object.values(insertEntry);
          
          console.log(`[DB] SQL: INSERT INTO "watchlist_entries" (${columns}) VALUES (${placeholders}) RETURNING *`);
          console.log(`[DB] Values:`, JSON.stringify(values));
          
          const rows = await executeDirectSql<WatchlistEntry>(
            `INSERT INTO "watchlist_entries" (${columns}) VALUES (${placeholders}) RETURNING *`,
            values,
            'Failed to create watchlist entry'
          );
          
          if (rows.length === 0) {
            console.error(`[DB] Direct SQL insert returned no data`);
            throw new Error('Watchlist entry creation did not return any data');
          }
          
          console.log(`[DB] Successfully created entry via direct SQL:`, JSON.stringify(rows[0]));
          return rows[0];
        } catch (fallbackError) {
          console.error(`[DB] Direct SQL fallback also failed:`, fallbackError);
          
          // One last attempt to check if entry exists (might have been created in a race condition)
          try {
            console.log(`[DB] Last chance check for existing entry`);
            const lastChanceCheck = await executeDirectSql<WatchlistEntry>(
              'SELECT * FROM "watchlist_entries" WHERE "userId" = $1 AND "movieId" = $2 LIMIT 1',
              [insertEntry.userId, insertEntry.movieId],
              'Failed to check for existing watchlist entry'
            );
            
            if (lastChanceCheck.length > 0) {
              console.log(`[DB] Found existing entry in last chance check, returning`, JSON.stringify(lastChanceCheck[0]));
              return lastChanceCheck[0];
            }
          } catch (e) {
            console.error(`[DB] Last chance check also failed:`, e);
            // Ignore this error and proceed with the original error
          }
          
          console.error(`[DB] All fallback attempts failed, throwing error`);
          throw fallbackError;
        }
      }
      
      console.error(`[DB] Final error in createWatchlistEntry:`, errorMessage);
      throw new Error(`Failed to create watchlist entry: ${errorMessage}`);
    }
  }

  async updateWatchlistEntry(id: number, updates: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined> {
    try {
      // Check if entry exists
      const entry = await this.getWatchlistEntry(id);
      if (!entry) return undefined;
      
      // Update only provided fields using ORM
      const [updatedEntry] = await db
        .update(watchlistEntries)
        .set(updates)
        .where(eq(watchlistEntries.id, id))
        .returning();
      
      return updatedEntry;
    } catch (error) {
      console.error("Database error in updateWatchlistEntry using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for updateWatchlistEntry");
          
          // Build SET clause for SQL update
          const setClause = Object.entries(updates)
            .map(([key, _], index) => `"${key}" = $${index + 2}`)
            .join(', ');
          
          const values = [id, ...Object.values(updates)];
          
          const rows = await executeDirectSql<WatchlistEntry>(
            `UPDATE "watchlist_entries" SET ${setClause} WHERE "id" = $1 RETURNING *`,
            values,
            'Failed to update watchlist entry'
          );
          
          if (rows.length === 0) {
            return undefined;
          }
          
          return rows[0];
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          throw fallbackError;
        }
      }
      
      throw new Error(`Failed to update watchlist entry: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    try {
      // Delete entry using ORM
      const result = await db
        .delete(watchlistEntries)
        .where(eq(watchlistEntries.id, id))
        .returning({ id: watchlistEntries.id });
      
      return result.length > 0;
    } catch (error) {
      console.error("Database error in deleteWatchlistEntry using ORM:", error);
      
      // Try direct SQL as fallback for connection issues
      if (this.shouldUseDirectSqlFallback(error)) {
        try {
          console.log("Attempting direct SQL fallback for deleteWatchlistEntry");
          const rows = await executeDirectSql<{id: number}>(
            'DELETE FROM "watchlist_entries" WHERE "id" = $1 RETURNING "id"',
            [id],
            'Failed to delete watchlist entry'
          );
          
          return rows.length > 0;
        } catch (fallbackError) {
          console.error("Direct SQL fallback also failed:", fallbackError);
          // Return false instead of throwing an error to avoid breaking the UI
          return false;
        }
      }
      
      // Return false for any other error rather than throwing
      console.warn("Error deleting watchlist entry, returning false:", error);
      return false;
    }
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
