import { Request, Response, Router } from 'express';
import { getDb } from './db.js';
import { movies, watchlistEntries, users, WatchlistEntry, WatchlistEntryWithMovie, Movie } from '../shared/schema.js';
import { eq, like, or, and, desc } from 'drizzle-orm';

// Temporary in-memory storage for emergency mode
const emergencyMemoryStorage = {
  users: new Map<string, any>(),
  isUsingEmergencyMode: false,
};

const router = Router();

/**
 * Emergency Watchlist API
 * Provides fallback endpoints for watchlist operations when primary systems fail
 */

/**
 * Search watchlist entries by title or overview
 */
router.get('/search/:userId', async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId);
    const searchTerm = req.query.q as string;

    // Verify user
    const userExists = await verifyUserFallback(userId);
    if (!userExists) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    const entries = await getWatchlistEntriesFallback(userId);
    const filteredEntries = entries.filter((entry: WatchlistEntryWithMovie) =>
      entry.movie.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.movie.overview && entry.movie.overview.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    console.log(`[EMERGENCY WATCHLIST] Retrieved ${filteredEntries.length} search results for user ${userId}`);
    res.json(filteredEntries);
  } catch (error) {
    console.error('[EMERGENCY WATCHLIST] Search error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * Add a new movie to the database
 */
router.post('/movie', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const movieData = {
      tmdbId: req.body.tmdbId,
      title: req.body.title,
      overview: req.body.overview || null,
      posterPath: req.body.posterPath || null,
      backdropPath: req.body.backdropPath || null,
      releaseDate: req.body.releaseDate || null,
      voteAverage: req.body.voteAverage || null,
      genres: req.body.genres || null,
      runtime: req.body.runtime || null,
      mediaType: req.body.mediaType as 'movie' | 'tv',
      numberOfSeasons: req.body.numberOfSeasons || null,
      numberOfEpisodes: req.body.numberOfEpisodes || null,
    };

    const [movie] = await db.insert(movies).values(movieData).returning();
    console.log(`[EMERGENCY WATCHLIST] Created movie ${movie.title} (TMDB ID: ${movie.tmdbId})`);
    res.json(movie);
  } catch (error) {
    console.error('[EMERGENCY WATCHLIST] Movie creation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * Add a new watchlist entry
 */
router.post('/watchlist', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId;
    const tmdbId = req.body.tmdbId;
    const mediaType = req.body.mediaType as 'movie' | 'tv';
    const title = req.body.title;

    // Verify user
    const userExists = await verifyUserFallback(userId);
    if (!userExists) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    const entry = await addWatchlistEntryFallback(userId, tmdbId, mediaType, title);
    if (!entry) {
      return res.status(400).json({
        status: 'error',
        message: 'Failed to add watchlist entry',
      });
    }

    res.status(201).json(entry);
  } catch (error) {
    console.error('[EMERGENCY WATCHLIST] Watchlist entry creation error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * Update a watchlist entry
 */
router.put('/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id);
    const userId = req.body.userId;

    // Verify user
    const userExists = await verifyUserFallback(userId);
    if (!userExists) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    const updateData = {
      userId: req.body.userId,
      movieId: req.body.movieId,
      platformId: req.body.platformId || null,
      status: req.body.status || 'to_watch',
      watchedDate: req.body.watchedDate || null,
      notes: req.body.notes || null,
      createdAt: new Date(),
    };

    const [updatedEntry] = await db
      .update(watchlistEntries)
      .set(updateData)
      .where(and(eq(watchlistEntries.id, id), eq(watchlistEntries.userId, userId)))
      .returning();

    if (!updatedEntry) {
      return res.status(404).json({
        status: 'error',
        message: 'Watchlist entry not found',
      });
    }

    console.log(`[EMERGENCY WATCHLIST] Updated watchlist entry ID ${id} for user ${userId}`);
    res.json(updatedEntry);
  } catch (error) {
    console.error('[EMERGENCY WATCHLIST] Watchlist entry update error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * Delete a watchlist entry
 */
router.delete('/watchlist/:id', async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    const id = parseInt(req.params.id);
    const userId = parseInt(req.query.userId as string);

    // Verify user
    const userExists = await verifyUserFallback(userId);
    if (!userExists) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    const result = await db
      .delete(watchlistEntries)
      .where(and(eq(watchlistEntries.id, id), eq(watchlistEntries.userId, userId)))
      .returning({ id: watchlistEntries.id });

    if (result.length > 0) {
      console.log(`[EMERGENCY WATCHLIST] Deleted watchlist entry ID ${id} for user ${userId}`);
      return res.status(204).send();
    }

    return res.status(404).json({
      status: 'error',
      message: 'Watchlist entry not found',
    });
  } catch (error) {
    console.error('[EMERGENCY WATCHLIST] Watchlist entry deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
    });
  }
});

/**
 * Fallback function to retrieve watchlist entries
 */
export async function getWatchlistEntriesFallback(userId: number): Promise<WatchlistEntryWithMovie[]> {
  try {
    const db = await getDb();
    const result = await db
      .select({
        id: watchlistEntries.id,
        userId: watchlistEntries.userId,
        movieId: watchlistEntries.movieId,
        platformId: watchlistEntries.platformId,
        status: watchlistEntries.status,
        watchedDate: watchlistEntries.watchedDate,
        notes: watchlistEntries.notes,
        createdAt: watchlistEntries.createdAt,
        movie: {
          id: movies.id,
          tmdbId: movies.tmdbId,
          title: movies.title,
          overview: movies.overview,
          posterPath: movies.posterPath,
          backdropPath: movies.backdropPath,
          releaseDate: movies.releaseDate,
          voteAverage: movies.voteAverage,
          genres: movies.genres,
          runtime: movies.runtime,
          mediaType: movies.mediaType,
          numberOfSeasons: movies.numberOfSeasons,
          numberOfEpisodes: movies.numberOfEpisodes,
        },
      })
      .from(watchlistEntries)
      .innerJoin(movies, eq(watchlistEntries.movieId, movies.id))
      .where(eq(watchlistEntries.userId, userId))
      .orderBy(desc(watchlistEntries.createdAt));

    console.log(`[WATCHLIST FALLBACK] Retrieved ${result.length} watchlist entries for user ${userId}`);
    return result as WatchlistEntryWithMovie[];
  } catch (error) {
    console.error('[WATCHLIST FALLBACK] Error fetching watchlist entries:', error);
    return [];
  }
}

/**
 * Fallback function to add a watchlist entry
 */
export async function addWatchlistEntryFallback(
  userId: number,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  title: string
): Promise<WatchlistEntry | null> {
  try {
    const db = await getDb();

    // Check if movie exists or create it
    let movie = await db
      .select()
      .from(movies)
      .where(eq(movies.tmdbId, tmdbId))
      .then((res) => res[0]);

    if (!movie) {
      const [newMovie] = await db
        .insert(movies)
        .values({
          tmdbId,
          title,
          mediaType,
          overview: null,
          posterPath: null,
          backdropPath: null,
          releaseDate: null,
          voteAverage: null,
          genres: null,
          runtime: null,
          numberOfSeasons: null,
          numberOfEpisodes: null,
        })
        .returning();
      movie = newMovie;
      console.log(`[WATCHLIST FALLBACK] Created movie ${title} (TMDB ID: ${tmdbId})`);
    }

    // Check if watchlist entry exists
    const existing = await db
      .select()
      .from(watchlistEntries)
      .where(and(eq(watchlistEntries.userId, userId), eq(watchlistEntries.movieId, movie.id)));

    if (existing.length > 0) {
      console.log(`[WATCHLIST FALLBACK] Watchlist entry already exists for user ${userId}, movie ID ${movie.id}`);
      return existing[0];
    }

    // Insert new watchlist entry
    const [entry] = await db
      .insert(watchlistEntries)
      .values({
        userId,
        movieId: movie.id,
        status: 'to_watch',
        createdAt: new Date(),
        platformId: null,
        watchedDate: null,
        notes: null,
      })
      .returning();

    console.log(`[WATCHLIST FALLBACK] Added watchlist entry for user ${userId}, movie ID ${movie.id}`);
    return entry;
  } catch (error) {
    console.error('[WATCHLIST FALLBACK] Error adding watchlist entry:', error);
    return null;
  }
}

/**
 * Fallback function to delete a watchlist entry
 */
export async function deleteWatchlistEntryFallback(userId: number, tmdbId: number): Promise<boolean> {
  try {
    const db = await getDb();

    // Find movie by tmdbId
    const movie = await db
      .select()
      .from(movies)
      .where(eq(movies.tmdbId, tmdbId))
      .then((res) => res[0]);

    if (!movie) {
      console.log(`[WATCHLIST FALLBACK] No movie found for TMDB ID ${tmdbId}`);
      return false;
    }

    // Delete watchlist entry
    const result = await db
      .delete(watchlistEntries)
      .where(and(eq(watchlistEntries.userId, userId), eq(watchlistEntries.movieId, movie.id)))
      .returning({ id: watchlistEntries.id });

    if (result.length > 0) {
      console.log(`[WATCHLIST FALLBACK] Deleted watchlist entry for user ${userId}, movie ID ${movie.id}`);
      return true;
    }

    console.log(`[WATCHLIST FALLBACK] No watchlist entry found to delete for user ${userId}, movie ID ${movie.id}`);
    return false;
  } catch (error) {
    console.error('[WATCHLIST FALLBACK] Error deleting watchlist entry:', error);
    return false;
  }
}

/**
 * Fallback function to verify a user
 */
export async function verifyUserFallback(userId: number): Promise<boolean> {
  try {
    // Check in-memory storage first
    if (emergencyMemoryStorage.users.has(userId.toString())) {
      console.log(`[WATCHLIST FALLBACK] User ${userId} found in emergency memory storage`);
      return true;
    }

    // Check database
    const db = await getDb();
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));

    if (user) {
      emergencyMemoryStorage.users.set(userId.toString(), user);
      console.log(`[WATCHLIST FALLBACK] User ${userId} verified in database`);
      return true;
    }

    console.log(`[WATCHLIST FALLBACK] User ${userId} not found`);
    return false;
  } catch (error) {
    console.error('[WATCHLIST FALLBACK] Error verifying user:', error);
    return false;
  }
}

export const emergencyWatchlistRouter = router;