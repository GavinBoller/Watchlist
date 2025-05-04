import { pgTable, serial, text, timestamp, integer, boolean, json, pgEnum } from 'drizzle-orm/pg-core';

// User table and types
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  environment: text('environment'),
});

export type User = {
  id: number;
  username: string;
  password?: string; // Made optional to resolve TS2741
  displayName: string | null;
  createdAt: Date | null;
  environment: string | null;
};

export type UserResponse = {
  id: number;
  username: string;
  password?: string;
  displayName: string | null;
  createdAt: Date | null;
  environment: string | null;
};

export type InsertUser = {
  username: string;
  password: string;
  displayName?: string | null;
  environment?: string | null;
};

// Movie table and types
export const movies = pgTable('movies', {
  id: serial('id').primaryKey(),
  tmdbId: integer('tmdb_id').notNull().unique(),
  title: text('title').notNull(),
  overview: text('overview'),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  releaseDate: text('release_date'),
  voteAverage: integer('vote_average'),
  genres: json('genres').$type<string[]>(),
  runtime: integer('runtime'),
  mediaType: text('media_type').notNull().$type<'movie' | 'tv'>(),
  numberOfSeasons: integer('number_of_seasons'),
  numberOfEpisodes: integer('number_of_episodes'),
});

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
  mediaType: 'movie' | 'tv';
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
};

export type InsertMovie = {
  tmdbId: number;
  title: string;
  overview?: string | null;
  posterPath?: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  voteAverage?: number | null;
  genres?: string[] | null;
  runtime?: number | null;
  mediaType?: 'movie' | 'tv';
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
};

// Platform table and types
export const platforms = pgTable('platforms', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Platform = {
  id: number;
  userId: number;
  name: string;
  logoUrl: string | null;
  isDefault: boolean;
  createdAt: Date;
};

export type InsertPlatform = {
  userId: number;
  name: string;
  logoUrl?: string | null;
  isDefault?: boolean;
};

// Watchlist entries table and types
export const watchlistStatusEnum = pgEnum('watchlist_status', ['to_watch', 'watching', 'watched']);

export const watchlistEntries = pgTable('watchlist_entries', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  movieId: integer('movie_id').notNull().references(() => movies.id),
  platformId: integer('platform_id').references(() => platforms.id),
  status: watchlistStatusEnum('status').notNull().default('to_watch'),
  watchedDate: timestamp('watched_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type WatchlistEntry = {
  id: number;
  userId: number;
  movieId: number;
  platformId: number | null;
  status: 'to_watch' | 'watching' | 'watched';
  watchedDate: Date | null;
  notes: string | null;
  createdAt: Date;
};

export type InsertWatchlistEntry = {
  userId: number;
  movieId: number;
  platformId?: number | null;
  status?: 'to_watch' | 'watching' | 'watched';
  watchedDate?: Date | null;
  notes?: string | null;
};

export type WatchlistEntryWithMovie = WatchlistEntry & {
  movie: Movie;
  platform?: Platform | null;
};

// Sessions table (for application session management)
export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  sessionToken: text('session_token').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
});

// Session store table for connect-pg-simple
export const sessionStore = pgTable('session_store', {
  sid: text('sid').primaryKey(),
  sess: json('sess').notNull(),
  expire: timestamp('expire').notNull(),
});