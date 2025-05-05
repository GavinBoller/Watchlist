const watchlistDb = require('./db.js');
const watchlistSchema = require('./shared/schema.js');
const { eq, and } = require('drizzle-orm');
import { WatchlistEntry, Movie } from './shared/types.js';

async function getEmergencyWatchlist(userId: number) {
  try {
    const userExists = await watchlistDb.db.select().from(watchlistSchema.users).where(eq(watchlistSchema.users.id, userId)).limit(1);
    if (!userExists.length) {
      throw new Error('User not found');
    }

    const entries = await watchlistDb.db
      .select({
        watchlistEntry: watchlistSchema.watchlistEntries,
        movie: watchlistSchema.movies,
      })
      .from(watchlistSchema.watchlistEntries)
      .leftJoin(watchlistSchema.movies, eq(watchlistSchema.watchlistEntries.movieId, watchlistSchema.movies.id))
      .where(eq(watchlistSchema.watchlistEntries.userId, userId));

    const result = entries.map((entry: { watchlistEntry: WatchlistEntry; movie: Movie }) => ({
      ...entry.watchlistEntry,
      movie: entry.movie,
    }));

    return result;
  } catch (err) {
    console.error('[EMERGENCY] Error fetching watchlist:', err);
    throw err;
  }
}

module.exports = { getEmergencyWatchlist };