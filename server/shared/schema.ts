"use strict";
const { pgTable, serial, text, timestamp, json, integer, boolean, pgEnum, varchar, numeric } = require('drizzle-orm/pg-core');

// User table
exports.users = pgTable('users', {
    id: serial('id').primaryKey(),
    username: text('username').notNull().unique(),
    password: text('password').notNull(),
    displayName: text('display_name'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    environment: text('environment'),
});

// Movie table
exports.movies = pgTable('movies', {
    id: serial('id').primaryKey(),
    tmdbId: integer('tmdb_id').notNull().unique(),
    title: text('title').notNull(),
    overview: text('overview'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    releaseDate: text('release_date'),
    voteAverage: numeric('vote_average'),
    genres: json('genres').$type(),
    runtime: integer('runtime'),
    mediaType: text('media_type').notNull().$type(),
    numberOfSeasons: integer('number_of_seasons'),
    numberOfEpisodes: integer('number_of_episodes'),
});

// Platform table
exports.platforms = pgTable('platforms', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => exports.users.id),
    name: text('name').notNull(),
    logoUrl: text('logo_url'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Watchlist entries table
exports.watchlistStatusEnum = pgEnum('watchlist_status', ['to_watch', 'watching', 'watched']);
exports.watchlistEntries = pgTable('watchlist_entries', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => exports.users.id),
    movieId: integer('movie_id').notNull().references(() => exports.movies.id),
    platformId: integer('platform_id').references(() => exports.platforms.id),
    status: exports.watchlistStatusEnum('status').notNull().default('to_watch'),
    watchedDate: timestamp('watched_date'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Sessions table
exports.sessions = pgTable('sessions', {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull().references(() => exports.users.id),
    sessionToken: text('session_token').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
});

// Session store table
exports.sessionStore = pgTable('session_store', {
    sid: varchar('sid').primaryKey(),
    sess: json('sess').notNull(),
    expire: timestamp('expire', { precision: 6 }).notNull(),
});

// Type definitions
exports.User = exports.users.$inferSelect;
exports.InsertUser = exports.users.$inferInsert;
exports.Movie = exports.movies.$inferSelect;
exports.InsertMovie = exports.movies.$inferInsert;
exports.Platform = exports.platforms.$inferSelect;
exports.InsertPlatform = exports.platforms.$inferInsert;
exports.WatchlistEntry = exports.watchlistEntries.$inferSelect;
exports.InsertWatchlistEntry = exports.watchlistEntries.$inferInsert;
exports.WatchlistEntryWithMovie = { ...exports.WatchlistEntry, movie: exports.Movie };

// Explicitly make this a module
module.exports = {
  users: exports.users,
  movies: exports.movies,
  platforms: exports.platforms,
  watchlistStatusEnum: exports.watchlistStatusEnum,
  watchlistEntries: exports.watchlistEntries,
  sessions: exports.sessions,
  sessionStore: exports.sessionStore,
  User: exports.User,
  InsertUser: exports.InsertUser,
  Movie: exports.Movie,
  InsertMovie: exports.InsertMovie,
  Platform: exports.Platform,
  InsertPlatform: exports.InsertPlatform,
  WatchlistEntry: exports.WatchlistEntry,
  InsertWatchlistEntry: exports.InsertWatchlistEntry,
  WatchlistEntryWithMovie: exports.WatchlistEntryWithMovie,
};