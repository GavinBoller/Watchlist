const storageDb = require('./db.js');
const storageSchema = require('./shared/schema.js');
const { eq: storageEq } = require('drizzle-orm');
import { User, UserResponse, Movie, Platform, WatchlistEntry, InsertMovie, InsertPlatform, InsertWatchlistEntry } from './shared/types.js';

const storage = {
  async getUser(id: number): Promise<User | null> {
    const db = await storageDb.getDb();
    const result = await db.select().from(storageSchema.users).where(storageEq(storageSchema.users.id, id)).limit(1);
    return result[0] || null;
  },

  async getUserByUsername(username: string): Promise<User | null> {
    const db = await storageDb.getDb();
    const result = await db.select().from(storageSchema.users).where(storageEq(storageSchema.users.username, username)).limit(1);
    return result[0] || null;
  },

  async getAllUsers(): Promise<User[]> {
    const db = await storageDb.getDb();
    return await db.select().from(storageSchema.users);
  },

  async updateUser(id: number, updates: Partial<User>): Promise<void> {
    const db = await storageDb.getDb();
    await db.update(storageSchema.users).set(updates).where(storageEq(storageSchema.users.id, id));
  },

  async createMovie(movie: InsertMovie): Promise<Movie> {
    const db = await storageDb.getDb();
    const result = await db.insert(storageSchema.movies).values(movie).returning();
    return result[0];
  },

  async createPlatform(platform: InsertPlatform): Promise<Platform> {
    const db = await storageDb.getDb();
    const result = await db.insert(storageSchema.platforms).values(platform).returning();
    return result[0];
  },

  async createWatchlistEntry(entry: InsertWatchlistEntry): Promise<WatchlistEntry & { movie: Movie }> {
    const db = await storageDb.getDb();
    const result = await db.insert(storageSchema.watchlistEntries).values(entry).returning();
    const [movie] = await db.select().from(storageSchema.movies).where(storageEq(storageSchema.movies.id, entry.movieId));
    return { ...result[0], movie };
  },

  async getWatchlistEntries(userId: number): Promise<(WatchlistEntry & { movie: Movie })[]> {
    const db = await storageDb.getDb();
    const entries = await db
      .select({
        watchlistEntry: storageSchema.watchlistEntries,
        movie: storageSchema.movies,
      })
      .from(storageSchema.watchlistEntries)
      .leftJoin(storageSchema.movies, storageEq(storageSchema.watchlistEntries.movieId, storageSchema.movies.id))
      .where(storageEq(storageSchema.watchlistEntries.userId, userId));
    return entries.map((e: { watchlistEntry: WatchlistEntry; movie: Movie }) => ({ ...e.watchlistEntry, movie: e.movie }));
  },

  async getWatchlistEntry(id: number): Promise<(WatchlistEntry & { movie: Movie }) | null> {
    const db = await storageDb.getDb();
    const [entry] = await db
      .select({
        watchlistEntry: storageSchema.watchlistEntries,
        movie: storageSchema.movies,
      })
      .from(storageSchema.watchlistEntries)
      .leftJoin(storageSchema.movies, storageEq(storageSchema.watchlistEntries.movieId, storageSchema.movies.id))
      .where(storageEq(storageSchema.watchlistEntries.id, id));
    return entry ? { ...entry.watchlistEntry, movie: entry.movie } : null;
  },

  async updateWatchlistEntry(id: number, updates: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry & { movie: Movie }> {
    const db = await storageDb.getDb();
    const result = await db.update(storageSchema.watchlistEntries).set(updates).where(storageEq(storageSchema.watchlistEntries.id, id)).returning();
    const [movie] = await db.select().from(storageSchema.movies).where(storageEq(storageSchema.movies.id, result[0].movieId));
    return { ...result[0], movie };
  },

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    const db = await storageDb.getDb();
    const result = await db.delete(storageSchema.watchlistEntries).where(storageEq(storageSchema.watchlistEntries.id, id)).returning();
    return result.length > 0;
  },

  async getPlatforms(userId: number): Promise<Platform[]> {
    const db = await storageDb.getDb();
    return await db.select().from(storageSchema.platforms).where(storageEq(storageSchema.platforms.userId, userId));
  },

  async getPlatform(id: number): Promise<Platform | null> {
    const db = await storageDb.getDb();
    const [platform] = await db.select().from(storageSchema.platforms).where(storageEq(storageSchema.platforms.id, id));
    return platform || null;
  },

  async updatePlatform(id: number, updates: Partial<InsertPlatform>): Promise<Platform> {
    const db = await storageDb.getDb();
    const result = await db.update(storageSchema.platforms).set(updates).where(storageEq(storageSchema.platforms.id, id)).returning();
    return result[0];
  },

  async deletePlatform(id: number): Promise<boolean> {
    const db = await storageDb.getDb();
    const result = await db.delete(storageSchema.platforms).where(storageEq(storageSchema.platforms.id, id)).returning();
    return result.length > 0;
  },
};

module.exports = { storage };