const express = require('express');
const axios = require('axios');
const db = require('./db.js');
const { z } = require('zod');
const schema = require('./shared/schema.js');
const auth = require('./auth.js');
const jwtMiddleware = require('./jwtMiddleware.js');
const storage = require('./storage.js');
const { like, eq } = require('drizzle-orm');

import { Request, Response } from 'express';
import { UserResponse, InsertMovie, InsertPlatform, InsertWatchlistEntry } from './shared/types.js';

const routesRouter = express.Router();

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'your-tmdb-api-key';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Zod schemas for validation
const insertMovieSchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  overview: z.string().nullable().optional(),
  posterPath: z.string().nullable().optional(),
  backdropPath: z.string().nullable().optional(),
  releaseDate: z.string().nullable().optional(),
  voteAverage: z.number().nullable().optional(),
  genres: z.array(z.string()).nullable().optional(),
  runtime: z.number().nullable().optional(),
  mediaType: z.enum(['movie', 'tv']).optional(),
  numberOfSeasons: z.number().nullable().optional(),
  numberOfEpisodes: z.number().nullable().optional(),
});

const insertPlatformSchema = z.object({
  userId: z.number(),
  name: z.string(),
  logoUrl: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
});

const insertWatchlistEntrySchema = z.object({
  userId: z.number(),
  movieId: z.number(),
  platformId: z.number().nullable().optional(),
  status: z.enum(['to_watch', 'watching', 'watched']).optional(),
  watchedDate: z.string().nullable().optional().transform((val: string) => (val ? new Date(val) : null)),
  notes: z.string().nullable().optional(),
});

// Search movies via TMDB
routesRouter.get('/search', jwtMiddleware.isJwtAuthenticated, async (req: Request, res: Response) => {
  const query: string = req.query.q as string;
  if (!query) {
    return res.status(400).json({
      status: 'error',
      message: 'Search query is required',
    });
  }
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/search/multi`, {
      params: {
        api_key: TMDB_API_KEY,
        query,
      },
    });

    const results = response.data.results.map((item: any) => ({
      tmdbId: item.id,
      title: item.title || item.name,
      overview: item.overview,
      posterPath: item.poster_path,
      backdropPath: item.backdrop_path,
      releaseDate: item.release_date || item.first_air_date,
      voteAverage: item.vote_average,
      mediaType: item.media_type,
    }));

    res.json(results);
  } catch (error) {
    console.error('[ROUTES] Search error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Get user profile
routesRouter.get('/profile/:userId', jwtMiddleware.isJwtAuthenticated, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user: UserResponse | undefined = req.user;
  if (!user || user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access profile of other users',
    });
  }
  try {
    const dbInstance = await db.getDb();
    const [profile] = await dbInstance
      .select({
        id: schema.users.id,
        username: schema.users.username,
        displayName: schema.users.displayName,
        createdAt: schema.users.createdAt,
        environment: schema.users.environment,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    if (!profile) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    res.json(profile);
  } catch (error) {
    console.error('[ROUTES] Profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Get movie details
routesRouter.get('/movie/:tmdbId', jwtMiddleware.isJwtAuthenticated, async (req: Request, res: Response) => {
  const tmdbId = parseInt(req.params.tmdbId);
  try {
    const dbInstance = await db.getDb();
    const [movie] = await dbInstance
      .select()
      .from(schema.movies)
      .where(like(schema.movies.tmdbId, `%${tmdbId}%`));

    if (movie) {
      return res.json(movie);
    }

    const response = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
      params: {
        api_key: TMDB_API_KEY,
      },
    });

    const movieData: InsertMovie = {
      tmdbId: response.data.id,
      title: response.data.title,
      overview: response.data.overview,
      posterPath: response.data.poster_path,
      backdropPath: response.data.backdrop_path,
      releaseDate: response.data.release_date,
      voteAverage: response.data.vote_average,
      genres: response.data.genres.map((g: { name: string }) => g.name),
      runtime: response.data.runtime,
      mediaType: 'movie',
      numberOfSeasons: null,
      numberOfEpisodes: null,
    };

    const validatedMovie = insertMovieSchema.parse(movieData);
    const createdMovie = await storage.storage.createMovie(validatedMovie);

    res.json(createdMovie);
  } catch (error) {
    console.error('[ROUTES] Movie fetch error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Get watchlist
routesRouter.get('/watchlist/:userId', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user: UserResponse | undefined = req.user;
  if (!user || user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access watchlist entries for other users',
    });
  }
  try {
    const entries = await storage.storage.getWatchlistEntries(userId);
    res.json(entries);
  } catch (error) {
    console.error('[ROUTES] Watchlist fetch error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Add to watchlist
routesRouter.post('/watchlist', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const entryData: InsertWatchlistEntry = {
      userId: user.id,
      movieId: req.body.movieId,
      platformId: req.body.platformId || null,
      status: req.body.status || 'to_watch',
      watchedDate: req.body.watchedDate || null,
      notes: req.body.notes || null,
    };

    const validatedEntry = insertWatchlistEntrySchema.parse(entryData);
    const entry = await storage.storage.createWatchlistEntry(validatedEntry);
    res.status(201).json(entry);
  } catch (error) {
    console.error('[ROUTES] Watchlist entry creation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Update watchlist entry
routesRouter.put('/watchlist/:id', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const entry = await storage.storage.getWatchlistEntry(id);
    if (!entry || entry.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot update watchlist entries for other users',
      });
    }

    const updateData: Partial<InsertWatchlistEntry> = {
      movieId: req.body.movieId || entry.movieId,
      platformId: req.body.platformId !== undefined ? req.body.platformId : entry.platformId,
      status: req.body.status || entry.status,
      watchedDate: req.body.watchedDate !== undefined ? req.body.watchedDate : entry.watchedDate,
      notes: req.body.notes !== undefined ? req.body.notes : entry.notes,
    };

    const validatedUpdate = insertWatchlistEntrySchema.partial().parse(updateData);
    const updatedEntry = await storage.storage.updateWatchlistEntry(id, validatedUpdate);
    res.json(updatedEntry);
  } catch (error) {
    console.error('[ROUTES] Watchlist entry update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Delete watchlist entry
routesRouter.delete('/watchlist/:id', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const entry = await storage.storage.getWatchlistEntry(id);
    if (!entry || entry.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot delete watchlist entries for other users',
      });
    }

    const deleted = await storage.storage.deleteWatchlistEntry(id);
    if (deleted) {
      res.status(204).send();
    } else {
      res.status(404).json({
        status: 'error',
        message: 'Watchlist entry not found',
      });
    }
  } catch (error) {
    console.error('[ROUTES] Watchlist entry deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Get platforms
routesRouter.get('/platforms/:userId', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user: UserResponse | undefined = req.user;
  if (!user || user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access platforms for other users',
    });
  }
  try {
    const platforms = await storage.storage.getPlatforms(userId);
    res.json(platforms);
  } catch (error) {
    console.error('[ROUTES] Platforms fetch error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Add platform
routesRouter.post('/platform', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const platformData: InsertPlatform = {
      userId: user.id,
      name: req.body.name,
      logoUrl: req.body.logoUrl || null,
      isDefault: req.body.isDefault || false,
    };

    const validatedPlatform = insertPlatformSchema.parse(platformData);
    const platform = await storage.storage.createPlatform(validatedPlatform);
    res.status(201).json(platform);
  } catch (error) {
    console.error('[ROUTES] Platform creation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Update platform
routesRouter.put('/platform/:id', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const platform = await storage.storage.getPlatform(id);
    if (!platform || platform.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot update platforms for other users',
      });
    }

    const updateData: Partial<InsertPlatform> = {
      name: req.body.name || platform.name,
      logoUrl: req.body.logoUrl !== undefined ? req.body.logoUrl : platform.logoUrl,
      isDefault: req.body.isDefault !== undefined ? req.body.isDefault : platform.isDefault,
    };

    const validatedUpdate = insertPlatformSchema.partial().parse(updateData);
    const updatedPlatform = await storage.storage.updatePlatform(id, validatedUpdate);
    res.json(updatedPlatform);
  } catch (error) {
    console.error('[ROUTES] Platform update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

// Delete platform
routesRouter.delete('/platform/:id', auth.hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user: UserResponse | undefined = req.user;
  if (!user) {
    return res.status(401).json({
      status: 'error',
      message: 'Authentication required',
    });
  }
  try {
    const platform = await storage.storage.getPlatform(id);
    if (!platform || platform.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot delete platforms for other users',
      });
    }

    const deleted = await storage.storage.deletePlatform(id);
    if (deleted) {
      res.status(204).send();
    } else {
      res.status(404).json({
        status: 'error',
        message: 'Platform not found',
      });
    }
  } catch (error) {
    console.error('[ROUTES] Platform deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

module.exports = routesRouter;