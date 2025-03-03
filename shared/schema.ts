import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
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
  mediaType: true,
});

export const watchlistEntries = pgTable("watchlist_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  movieId: integer("movie_id").notNull(),
  watchedDate: timestamp("watched_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Create a modified schema for watchlist entry inserts that accepts strings for dates
// This is necessary for SQLite compatibility
export const insertWatchlistEntrySchema = z.object({
  userId: z.number(),
  movieId: z.number(),
  watchedDate: z.string().nullable(),
  notes: z.string().nullable(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Movie = typeof movies.$inferSelect;
export type InsertMovie = z.infer<typeof insertMovieSchema>;

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
}
