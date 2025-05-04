import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { getDb } from './db.js';
import { users, InsertUser, User, movies, InsertMovie, platforms, InsertPlatform, watchlistEntries, InsertWatchlistEntry, Platform, WatchlistEntry } from '../shared/schema.js';
import { InferSelectModel } from 'drizzle-orm';

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  createMovie(movie: InsertMovie): Promise<unknown>;
  createPlatform(platform: InsertPlatform): Promise<unknown>;
  createWatchlistEntry(entry: InsertWatchlistEntry): Promise<unknown>;
  getWatchlistEntriesByUserId(userId: number): Promise<unknown[]>;
  getWatchlistEntries(userId: number): Promise<WatchlistEntry[]>;
  getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined>;
  updateWatchlistEntry(id: number, entry: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined>;
  deleteWatchlistEntry(id: number): Promise<boolean>;
  getPlatforms(userId: number): Promise<Platform[]>;
  getPlatform(id: number): Promise<Platform | undefined>;
  updatePlatform(id: number, platform: Partial<InsertPlatform>): Promise<Platform | undefined>;
  deletePlatform(id: number): Promise<boolean>;
}

type DrizzleUser = InferSelectModel<typeof users>;

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    try {
      const db = await getDb();
      const [drizzleUser]: DrizzleUser[] = await db
        .select({
          id: users.id,
          username: users.username,
          password: users.password,
          displayName: users.displayName,
          createdAt: users.createdAt,
          environment: users.environment,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (drizzleUser) {
        return {
          id: drizzleUser.id,
          username: drizzleUser.username,
          password: drizzleUser.password,
          displayName: drizzleUser.displayName,
          createdAt: drizzleUser.createdAt,
          environment: drizzleUser.environment,
        };
      }
      return undefined;
    } catch (error) {
      console.error('[DB] Error in getUser:', error);
      return undefined;
    }
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    try {
      console.log(`[DB] Looking up user by username: ${username}`);
      const db = await getDb();
      const rawResult = await db
        .select()
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1);
      console.log('[DB] Raw query result:', rawResult);
      const [drizzleUser]: DrizzleUser[] = await db
        .select({
          id: users.id,
          username: users.username,
          password: users.password,
          displayName: users.displayName,
          createdAt: users.createdAt,
          environment: users.environment,
        })
        .from(users)
        .where(eq(users.username, username.toLowerCase()))
        .limit(1);
      console.log('[DB] Selected query result:', drizzleUser);
      if (drizzleUser) {
        const user: User = {
          id: drizzleUser.id,
          username: drizzleUser.username,
          password: drizzleUser.password,
          displayName: drizzleUser.displayName,
          createdAt: drizzleUser.createdAt,
          environment: drizzleUser.environment,
        };
        console.log(`[DB] Found user: ${user.username} (ID: ${user.id})`);
        return user;
      }
      console.log(`[DB] No user found with username: ${username}`);
      return undefined;
    } catch (error) {
      console.error('[DB] Error in getUserByUsername:', error);
      return undefined;
    }
  }

  async createUser(user: InsertUser): Promise<User> {
    try {
      const db = await getDb();
      const [newUser] = await db
        .insert(users)
        .values({
          username: user.username.toLowerCase(),
          password: user.password,
          displayName: user.displayName,
          environment: user.environment,
        })
        .returning();
      return newUser;
    } catch (error) {
      console.error('[DB] Error in createUser:', error);
      throw error;
    }
  }

  async createMovie(movie: InsertMovie): Promise<unknown> {
    try {
      const db = await getDb();
      const movieWithDefault = {
        ...movie,
        mediaType: movie.mediaType || 'movie',
      };
      const [newMovie] = await db.insert(movies).values(movieWithDefault).returning();
      return newMovie;
    } catch (error) {
      console.error('[DB] Error in createMovie:', error);
      throw error;
    }
  }

  async createPlatform(platform: InsertPlatform): Promise<unknown> {
    try {
      const db = await getDb();
      const [newPlatform] = await db.insert(platforms).values(platform).returning();
      return newPlatform;
    } catch (error) {
      console.error('[DB] Error in createPlatform:', error);
      throw error;
    }
  }

  async createWatchlistEntry(entry: InsertWatchlistEntry): Promise<unknown> {
    try {
      const db = await getDb();
      const [newEntry] = await db.insert(watchlistEntries).values(entry).returning();
      return newEntry;
    } catch (error) {
      console.error('[DB] Error in createWatchlistEntry:', error);
      throw error;
    }
  }

  async getWatchlistEntriesByUserId(userId: number): Promise<unknown[]> {
    try {
      const db = await getDb();
      const entries = await db
        .select()
        .from(watchlistEntries)
        .where(eq(watchlistEntries.userId, userId));
      return entries;
    } catch (error) {
      console.error('[DB] Error in getWatchlistEntriesByUserId:', error);
      return [];
    }
  }

  async getWatchlistEntries(userId: number): Promise<WatchlistEntry[]> {
    try {
      const db = await getDb();
      const entries = await db
        .select()
        .from(watchlistEntries)
        .where(eq(watchlistEntries.userId, userId));
      return entries;
    } catch (error) {
      console.error('[DB] Error in getWatchlistEntries:', error);
      return [];
    }
  }

  async getWatchlistEntry(id: number): Promise<WatchlistEntry | undefined> {
    try {
      const db = await getDb();
      const [entry] = await db
        .select()
        .from(watchlistEntries)
        .where(eq(watchlistEntries.id, id))
        .limit(1);
      return entry || undefined;
    } catch (error) {
      console.error('[DB] Error in getWatchlistEntry:', error);
      return undefined;
    }
  }

  async updateWatchlistEntry(id: number, entry: Partial<InsertWatchlistEntry>): Promise<WatchlistEntry | undefined> {
    try {
      const db = await getDb();
      const [updatedEntry] = await db
        .update(watchlistEntries)
        .set(entry)
        .where(eq(watchlistEntries.id, id))
        .returning();
      return updatedEntry || undefined;
    } catch (error) {
      console.error('[DB] Error in updateWatchlistEntry:', error);
      return undefined;
    }
  }

  async deleteWatchlistEntry(id: number): Promise<boolean> {
    try {
      const db = await getDb();
      const result = await db
        .delete(watchlistEntries)
        .where(eq(watchlistEntries.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('[DB] Error in deleteWatchlistEntry:', error);
      return false;
    }
  }

  async getPlatforms(userId: number): Promise<Platform[]> {
    try {
      const db = await getDb();
      const platformsList = await db
        .select()
        .from(platforms)
        .where(eq(platforms.userId, userId));
      return platformsList;
    } catch (error) {
      console.error('[DB] Error in getPlatforms:', error);
      return [];
    }
  }

  async getPlatform(id: number): Promise<Platform | undefined> {
    try {
      const db = await getDb();
      const [platform] = await db
        .select()
        .from(platforms)
        .where(eq(platforms.id, id))
        .limit(1);
      return platform || undefined;
    } catch (error) {
      console.error('[DB] Error in getPlatform:', error);
      return undefined;
    }
  }

  async updatePlatform(id: number, platform: Partial<InsertPlatform>): Promise<Platform | undefined> {
    try {
      const db = await getDb();
      const [updatedPlatform] = await db
        .update(platforms)
        .set(platform)
        .where(eq(platforms.id, id))
        .returning();
      return updatedPlatform || undefined;
    } catch (error) {
      console.error('[DB] Error in updatePlatform:', error);
      return undefined;
    }
  }

  async deletePlatform(id: number): Promise<boolean> {
    try {
      const db = await getDb();
      const result = await db
        .delete(platforms)
        .where(eq(platforms.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('[DB] Error in deletePlatform:', error);
      return false;
    }
  }
}

export const storage: IStorage = new DatabaseStorage();