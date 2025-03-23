import { pgTable, text, serial, integer, boolean, timestamp, primaryKey, foreignKey, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define the session table to match connect-pg-simple's structure
// This is important to avoid it being deleted during migrations
export const sessions = pgTable("session", {
  // Standard varchar column
  sid: text("sid").notNull().primaryKey(),
  // JSON data column
  sess: text("sess").notNull(),
  // Timestamp column
  expire: timestamp("expire", { mode: 'date' }).notNull(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").defaultNow(),
  environment: text("environment").default("development"),
});

// For app use (includes password)
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  environment: true,
});

// For API response (excludes password)
export const userResponseSchema = createInsertSchema(users)
  .pick({
    id: true,
    username: true,
    displayName: true,
    createdAt: true,
    environment: true,
  });

export const movies = pgTable("movies", {
  id: serial("id").primaryKey(),
  tmdbId: integer("tmdb_id").notNull(),
  title: text("title").notNull(),
  overview: text("overview"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  releaseDate: text("release_date"),
  voteAverage: text("vote_average"),
  genres: text("genres"),
  runtime: integer("runtime"), // Runtime in minutes
  numberOfSeasons: integer("number_of_seasons"), // Number of seasons (for TV shows)
  numberOfEpisodes: integer("number_of_episodes"), // Total episodes (for TV shows)
  mediaType: text("media_type").notNull().default("movie"), // "movie" or "tv"
});

export const insertMovieSchema = createInsertSchema(movies).pick({
  tmdbId: true,
  title: true,
  overview: true,
  posterPath: true,
  backdropPath: true,
  releaseDate: true,
  voteAverage: true,
  genres: true,
  runtime: true,
  numberOfSeasons: true,
  numberOfEpisodes: true,
  mediaType: true,
});

export const platforms = pgTable("platforms", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPlatformSchema = createInsertSchema(platforms).pick({
  userId: true,
  name: true,
  logoUrl: true,
  isDefault: true,
});

export const watchlistEntries = pgTable("watchlist_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  movieId: integer("movie_id").notNull(),
  platformId: integer("platform_id").references(() => platforms.id, { onDelete: "set null" }),
  watchedDate: text("watched_date"), // Using text for SQLite compatibility
  notes: text("notes"),
  status: text("status").notNull().default("to_watch"), // Options: "to_watch", "watching", "watched"
  createdAt: timestamp("created_at").defaultNow(),
});

// Create a modified schema for watchlist entry inserts that accepts strings for dates
// This is necessary for SQLite compatibility
export const insertWatchlistEntrySchema = z.object({
  userId: z.number(),
  movieId: z.number(),
  platformId: z.number().nullable().optional(),
  watchedDate: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(["to_watch", "watching", "watched"]).default("to_watch"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserResponse = Omit<User, 'password'>;

export type Movie = typeof movies.$inferSelect;
export type InsertMovie = z.infer<typeof insertMovieSchema>;

export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = z.infer<typeof insertPlatformSchema>;

export type WatchlistEntry = typeof watchlistEntries.$inferSelect;
export type InsertWatchlistEntry = z.infer<typeof insertWatchlistEntrySchema>;

// TMDb API related types
export interface TMDBMovie {
  id: number;
  title?: string;
  name?: string;  // For TV shows
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date?: string;
  first_air_date?: string;  // For TV shows
  vote_average: number;
  genre_ids: number[];
  media_type?: string;  // 'movie' or 'tv'
  runtime?: number;     // Runtime in minutes (for movies only)
  number_of_seasons?: number; // Number of seasons (for TV shows only)
  number_of_episodes?: number; // Total episodes across all seasons (for TV shows only)
}

export interface TMDBSearchResponse {
  page: number;
  results: TMDBMovie[];
  total_results: number;
  total_pages: number;
}

// Type for watchlist entry with movie details
export interface WatchlistEntryWithMovie extends WatchlistEntry {
  movie: Movie;
  platform?: Platform | null;
}
