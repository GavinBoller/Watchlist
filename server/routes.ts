import { Request, Response, Router } from 'express';
import axios from 'axios';
import { getDb } from './db.js';
import { z } from 'zod';
import { InsertMovie, InsertPlatform, InsertWatchlistEntry, Movie, Platform, UserResponse, WatchlistEntryWithMovie, users, movies } from '../shared/schema.js';
import { isAuthenticated, hasWatchlistAccess } from './auth.js';
import { isJwtAuthenticated } from './jwtMiddleware.js';
import { storage } from './storage.js';
import { like, eq } from 'drizzle-orm';

const router = Router();

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY || 'your-tmdb-api-key';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

// Zod schemas for validation (moved from shared/schema.ts)
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
  watchedDate: z.string().nullable().optional().transform((val) => (val ? new Date(val) : null)),
  notes: z.string().nullable().optional(),
});

// Search movies via TMDB
router.get('/search', isJwtAuthenticated, async (req: Request, res: Response) => {
  const query = req.query.q as string;
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
router.get('/profile/:userId', isJwtAuthenticated, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user = req.user as UserResponse;

  if (user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access profile of other users',
    });
  }

  try {
    const db = await getDb();
    const [profile] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        createdAt: users.createdAt,
        environment: users.environment,
      })
      .from(users)
      .where(eq(users.id, userId));

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
router.get('/movie/:tmdbId', isJwtAuthenticated, async (req: Request, res: Response) => {
  const tmdbId = parseInt(req.params.tmdbId);

  try {
    const db = await getDb();
    const [movie] = await db
      .select()
      .from(movies)
      .where(like(movies.tmdbId, `%${tmdbId}%`));

    if (movie) {
      return res.json(movie);
    }

    const response = await axios.get(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
      params: {
        api_key: TMDB_API_KEY,
      },
    });

    const movieData: Movie = {
      id: 0, // Will be set by DB
      tmdbId: response.data.id,
      title: response.data.title,
      overview: response.data.overview,
      posterPath: response.data.poster_path,
      backdropPath: response.data.backdrop_path,
      releaseDate: response.data.release_date,
      voteAverage: response.data.vote_average,
      genres: response.data.genres.map((g: any) => g.name),
      runtime: response.data.runtime,
      mediaType: 'movie',
      numberOfSeasons: null,
      numberOfEpisodes: null,
    };

    const validatedMovie = insertMovieSchema.parse(movieData);
    const createdMovie = await storage.createMovie(validatedMovie);

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
router.get('/watchlist/:userId', hasWatchlistAccess, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user = req.user as UserResponse;

  if (user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access watchlist entries for other users',
    });
  }

  try {
    const entries = await storage.getWatchlistEntries(userId);
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
router.post('/watchlist', hasWatchlistAccess, async (req: Request, res: Response) => {
  const user = req.user as UserResponse;

  try {
    const entryData = {
      userId: user.id,
      movieId: req.body.movieId,
      platformId: req.body.platformId || null,
      status: req.body.status || 'to_watch',
      watchedDate: req.body.watchedDate || null,
      notes: req.body.notes || null,
    };

    const validatedEntry = insertWatchlistEntrySchema.parse(entryData);
    const entry = await storage.createWatchlistEntry(validatedEntry);
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
router.put('/watchlist/:id', hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user = req.user as UserResponse;

  try {
    const entry = await storage.getWatchlistEntry(id);
    if (!entry || entry.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot update watchlist entries for other users',
      });
    }

    const updateData = {
      movieId: req.body.movieId || entry.movieId,
      platformId: req.body.platformId !== undefined ? req.body.platformId : entry.platformId,
      status: req.body.status || entry.status,
      watchedDate: req.body.watchedDate !== undefined ? req.body.watchedDate : entry.watchedDate,
      notes: req.body.notes !== undefined ? req.body.notes : entry.notes,
    };

    const validatedUpdate = insertWatchlistEntrySchema.partial().parse(updateData);
    const updatedEntry = await storage.updateWatchlistEntry(id, validatedUpdate);
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
router.delete('/watchlist/:id', hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user = req.user as UserResponse;

  try {
    const entry = await storage.getWatchlistEntry(id);
    if (!entry || entry.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot delete watchlist entries for other users',
      });
    }

    const deleted = await storage.deleteWatchlistEntry(id);
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
router.get('/platforms/:userId', hasWatchlistAccess, async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId);
  const user = req.user as UserResponse;

  if (user.id !== userId) {
    return res.status(403).json({
      status: 'error',
      message: 'Cannot access platforms for other users',
    });
  }

  try {
    const platforms = await storage.getPlatforms(userId);
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
router.post('/platform', hasWatchlistAccess, async (req: Request, res: Response) => {
  const user = req.user as UserResponse;

  try {
    const platformData = {
      userId: user.id,
      name: req.body.name,
      logoUrl: req.body.logoUrl || null,
      isDefault: req.body.isDefault || false,
    };

    const validatedPlatform = insertPlatformSchema.parse(platformData);
    const platform = await storage.createPlatform(validatedPlatform);
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
router.put('/platform/:id', hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user = req.user as UserResponse;

  try {
    const platform = await storage.getPlatform(id);
    if (!platform || platform.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot update platforms for other users',
      });
    }

    const updateData = {
      name: req.body.name || platform.name,
      logoUrl: req.body.logoUrl !== undefined ? req.body.logoUrl : platform.logoUrl,
      isDefault: req.body.isDefault !== undefined ? req.body.isDefault : platform.isDefault,
    };

    const validatedUpdate = insertPlatformSchema.partial().parse(updateData);
    const updatedPlatform = await storage.updatePlatform(id, validatedUpdate);
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
router.delete('/platform/:id', hasWatchlistAccess, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const user = req.user as UserResponse;

  try {
    const platform = await storage.getPlatform(id);
    if (!platform || platform.userId !== user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot delete platforms for other users',
      });
    }

    const deleted = await storage.deletePlatform(id);
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

export const routes = router;