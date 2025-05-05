"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionStore = exports.sessions = exports.watchlistEntries = exports.watchlistStatusEnum = exports.platforms = exports.movies = exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");

// User table and types
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    username: (0, pg_core_1.text)('username').notNull().unique(),
    password: (0, pg_core_1.text)('password').notNull(),
    displayName: (0, pg_core_1.text)('display_name'),
    createdAt: (0, pg_core_1.timestamp)('created_at').notNull().defaultNow(),
    environment: (0, pg_core_1.text)('environment'),
});

// Movie table and types
exports.movies = (0, pg_core_1.pgTable)('movies', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    tmdbId: (0, pg_core_1.integer)('tmdb_id').notNull().unique(),
    title: (0, pg_core_1.text)('title').notNull(),
    overview: (0, pg_core_1.text)('overview'),
    posterPath: (0, pg_core_1.text)('poster_path'),
    backdropPath: (0, pg_core_1.text)('backdrop_path'),
    releaseDate: (0, pg_core_1.text)('release_date'),
    voteAverage: (0, pg_core_1.integer)('vote_average'),
    genres: (0, pg_core_1.json)('genres').$type(),
    runtime: (0, pg_core_1.integer)('runtime'),
    mediaType: (0, pg_core_1.text)('media_type').notNull().$type(),
    numberOfSeasons: (0, pg_core_1.integer)('number_of_seasons'),
    numberOfEpisodes: (0, pg_core_1.integer)('number_of_episodes'),
});

// Platform table and types
exports.platforms = (0, pg_core_1.pgTable)('platforms', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userId: (0, pg_core_1.integer)('user_id').notNull().references(() => exports.users.id),
    name: (0, pg_core_1.text)('name').notNull(),
    logoUrl: (0, pg_core_1.text)('logo_url'),
    isDefault: (0, pg_core_1.boolean)('is_default').notNull().default(false),
    createdAt: (0, pg_core_1.timestamp)('created_at').notNull().defaultNow(),
});

// Watchlist entries table and types
exports.watchlistStatusEnum = (0, pg_core_1.pgEnum)('watchlist_status', ['to_watch', 'watching', 'watched']);
exports.watchlistEntries = (0, pg_core_1.pgTable)('watchlist_entries', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userId: (0, pg_core_1.integer)('user_id').notNull().references(() => exports.users.id),
    movieId: (0, pg_core_1.integer)('movie_id').notNull().references(() => exports.movies.id),
    platformId: (0, pg_core_1.integer)('platform_id').references(() => exports.platforms.id),
    status: (0, exports.watchlistStatusEnum)('status').notNull().default('to_watch'),
    watchedDate: (0, pg_core_1.timestamp)('watched_date'),
    notes: (0, pg_core_1.text)('notes'),
    createdAt: (0, pg_core_1.timestamp)('created_at').notNull().defaultNow(),
});

// Sessions table (for application session management)
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.serial)('id').primaryKey(),
    userId: (0, pg_core_1.integer)('user_id').notNull().references(() => exports.users.id),
    sessionToken: (0, pg_core_1.text)('session_token').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at').notNull().defaultNow(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at').notNull(),
});

// Session store table for connect-pg-simple
exports.sessionStore = (0, pg_core_1.pgTable)('session_store', {
    sid: (0, pg_core_1.varchar)('sid').primaryKey(),
    sess: (0, pg_core_1.json)('sess').notNull(),
    expire: (0, pg_core_1.timestamp)('expire', { precision: 6 }).notNull(),
});