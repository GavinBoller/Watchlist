import { Request, Response, Router } from 'express';
import { getDb } from './db.js';
import { users, movies, watchlistEntries, sessions, platforms } from '../shared/schema.js';
import { count, eq, and, gt, sql, desc } from 'drizzle-orm';
import { isJwtAuthenticated } from './jwtMiddleware.js';

// Types for database query responses
interface UserActivityData {
  id: number;
  username: string;
  displayName: string | null;
  watchlistCount: number;
  lastActivity: string | null;
  lastSeen: string | null;
  lastLogin: string | null;
  databaseEnvironment: string | null;
}

interface RecentRegistration {
  username: string;
  displayName: string | null;
  createdAt: string | null;
  databaseEnvironment: string | null;
}

interface RecentActivity {
  username: string;
  title: string;
  createdAt: string | null;
  status: 'to_watch' | 'watching' | 'watched';
  databaseEnvironment: string | null;
}

// Helper function to format PostgreSQL timestamps to ISO format
function formatPostgresTimestamp(timestamp: string | Date | null): string | null {
  if (!timestamp) return null;
  try {
    const timestampStr = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp);
    if (timestampStr.includes('.')) {
      return timestampStr.replace(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}).*/, '$1T$2.000Z');
    }
    if (timestampStr.includes(' ') && !timestampStr.includes('T')) {
      return timestampStr.replace(' ', 'T') + '.000Z';
    }
    if (!timestampStr.endsWith('Z') && timestampStr.includes('T')) {
      return timestampStr + '.000Z';
    }
    return timestampStr;
  } catch (e) {
    console.error('Error formatting timestamp:', timestamp, e);
    return String(timestamp);
  }
}

const router = Router();

/**
 * Simple status route to check if the API is up
 */
router.get('/ping', async (_req: Request, res: Response) => {
  try {
    console.log('[PING] Attempting database query');
    const db = await getDb();
    await db.select({ count: sql`1` }).from(users).limit(1);
    console.log('[PING] Database query successful');
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch (error) {
    console.error('[PING] Error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal Server Error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Public route to check admin users
 */
router.get('/admin-check', async (_req: Request, res: Response) => {
  try {
    const adminIds = process.env.ADMIN_IDS
      ? process.env.ADMIN_IDS.split(',').map((id) => parseInt(id.trim(), 10))
      : [1, 30];
    const adminUsernames = process.env.ADMIN_USERNAMES
      ? process.env.ADMIN_USERNAMES.split(',').map((name) => name.trim())
      : ['Gavinadmin', 'Gaju'];

    const db = await getDb();
    const admins = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .where(
        sql`${users.id} IN (${adminIds.join(',')}) OR ${users.username} IN (${adminUsernames
          .map((name) => `'${name}'`)
          .join(',')})`
      )
      .orderBy(users.id);

    if (admins.length > 0) {
      res.json({
        status: 'ok',
        adminUsers: admins.map((user) => ({
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
        })),
      });
    } else {
      console.log('No admin users found in database');
      res.json({
        status: 'ok',
        adminUsers: [
          {
            id: 1,
            username: 'admin',
            displayName: 'Default Admin',
          },
        ],
        note: 'No admin users found in database, showing default admin user',
      });
    }
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not determine admin users',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get basic system stats
 */
router.get('/stats', isJwtAuthenticated, async (req: Request, res: Response) => {
  const user = req.user as { id: number; username: string } | undefined;
  if (!user) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required',
    });
  }

  const adminIds = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map((id) => parseInt(id.trim(), 10))
    : [1, 30];
  const adminUsernames = process.env.ADMIN_USERNAMES
    ? process.env.ADMIN_USERNAMES.split(',').map((name) => name.trim())
    : ['Gavinadmin', 'Gaju'];
  const isAdmin = adminIds.includes(user.id) || adminUsernames.includes(user.username);

  if (!isAdmin) {
    console.log(`[ADMIN] Access DENIED to stats for non-admin user: ${user.username} (ID: ${user.id})`);
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Administrator privileges required',
    });
  }

  console.log(`[ADMIN] Stats accessed by user: ${user.username} (ID: ${user.id})`);

  const nodeEnv = process.env.NODE_ENV || 'development';
  const hasReplitDeploymentIndicators = !!(process.env.REPL_SLUG && process.env.REPLIT_RUN_COMMAND);
  const dbUrl = process.env.DATABASE_URL || '';
  const hasProdDatabase =
    dbUrl.includes('prod') ||
    (nodeEnv === 'production' && (dbUrl.includes('amazonaws.com') || dbUrl.includes('render.com')));
  const isProduction = nodeEnv === 'production';
  const isDevelopment = !isProduction;

  console.log(`Environment detection for stats endpoint:`);
  console.log(`- NODE_ENV: ${nodeEnv}`);
  console.log(`- Replit deployment indicators: ${hasReplitDeploymentIndicators}`);
  console.log(`- Production database indicators: ${hasProdDatabase}`);
  console.log(`- Final environment: ${isDevelopment ? 'development' : 'production'}`);

  const envOverride = process.env.FORCE_ENVIRONMENT;
  if (envOverride === 'development' || envOverride === 'production') {
    console.log(`Environment override applied: ${envOverride}`);
  }

  const responseData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isDevelopment ? 'development' : 'production',
    stats: {
      users: {
        total: 0,
        topUsers: [] as any[],
        userActivity: [] as UserActivityData[],
      },
      content: {
        movies: 0,
        tvShows: 0,
        watchlistEntries: 0,
        platforms: 0,
      },
      system: {
        database: {
          connected: true,
          lastChecked: new Date().toISOString(),
        },
        sessions: 0,
      },
    },
  };

  try {
    const db = await getDb();
    const environmentValue = isDevelopment ? 'development' : 'production';

    // Get total user count
    try {
      console.log(`Environment for user count: ${environmentValue}`);
      const userCountResult = await db.select({ count: count() }).from(users);
      responseData.stats.users.total = Number(userCountResult[0].count);
    } catch (error) {
      console.error('Error getting user count:', error);
    }

    // Get content stats
    try {
      console.log(`Environment for content stats: ${environmentValue}`);
      const movieCountResult = await db
        .select({ count: count() })
        .from(movies)
        .innerJoin(watchlistEntries, eq(movies.id, watchlistEntries.movieId))
        .innerJoin(users, eq(watchlistEntries.userId, users.id))
        .where(and(eq(movies.mediaType, 'movie'), eq(users.environment, environmentValue)));

      const tvCountResult = await db
        .select({ count: count() })
        .from(movies)
        .innerJoin(watchlistEntries, eq(movies.id, watchlistEntries.movieId))
        .innerJoin(users, eq(watchlistEntries.userId, users.id))
        .where(and(eq(movies.mediaType, 'tv'), eq(users.environment, environmentValue)));

      const watchlistCountResult = await db
        .select({ count: count() })
        .from(watchlistEntries)
        .innerJoin(users, eq(watchlistEntries.userId, users.id))
        .where(eq(users.environment, environmentValue));

      const platformCountResult = await db
        .select({ count: count() })
        .from(platforms)
        .innerJoin(users, eq(platforms.userId, users.id))
        .where(eq(users.environment, environmentValue));

      const sessionCountResult = await db
        .select({ count: count() })
        .from(sessions)
        .where(gt(sessions.expiresAt, new Date()));

      responseData.stats.content.movies = Number(movieCountResult[0].count);
      responseData.stats.content.tvShows = Number(tvCountResult[0].count);
      responseData.stats.content.watchlistEntries = Number(watchlistCountResult[0].count);
      responseData.stats.content.platforms = Number(platformCountResult[0].count);
      responseData.stats.system.sessions = Number(sessionCountResult[0].count);
    } catch (error) {
      console.error('Error getting count data:', error);
    }

    // Get top users and user activity
    try {
      const topUsersResult = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          entry_count: count(watchlistEntries.id),
          databaseEnvironment: users.environment,
        })
        .from(users)
        .innerJoin(watchlistEntries, eq(users.id, watchlistEntries.userId))
        .where(eq(users.environment, environmentValue))
        .groupBy(users.id, users.username, users.displayName, users.environment)
        .orderBy(desc(count(watchlistEntries.id)))
        .limit(5);
      responseData.stats.users.topUsers = topUsersResult.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        entryCount: Number(user.entry_count),
        databaseEnvironment: user.databaseEnvironment,
      }));

      const userActivityResult = await db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          watchlist_count: count(watchlistEntries.id),
          last_activity: sql`MAX(${watchlistEntries.createdAt})`,
          last_seen: sql`NULL`,
          registration_date: users.createdAt,
          databaseEnvironment: users.environment,
        })
        .from(users)
        .leftJoin(watchlistEntries, eq(users.id, watchlistEntries.userId))
        .groupBy(users.id, users.username, users.displayName, users.createdAt, users.environment)
        .orderBy(desc(users.createdAt));

      responseData.stats.users.userActivity = userActivityResult.map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        watchlistCount: Number(user.watchlist_count),
        lastActivity: user.last_activity ? formatPostgresTimestamp(user.last_activity as string) : null,
        lastSeen: null,
        lastLogin: formatPostgresTimestamp(user.registration_date as unknown as string),
        databaseEnvironment: user.databaseEnvironment,
      }));
    } catch (error) {
      console.error('Error getting user activity data:', error);
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error generating status stats:', error);
    res.json({
      status: 'partial',
      timestamp: new Date().toISOString(),
      message: 'Some data could not be loaded',
      stats: responseData.stats,
    });
  }
});

/**
 * Get detailed user statistics (admin only)
 */
router.get('/user-activity', isJwtAuthenticated, async (req: Request, res: Response) => {
  const user = req.user as { id: number; username: string } | undefined;
  if (!user) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required',
    });
  }

  const adminIds = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(',').map((id) => parseInt(id.trim(), 10))
    : [1, 30];
  const adminUsernames = process.env.ADMIN_USERNAMES
    ? process.env.ADMIN_USERNAMES.split(',').map((name) => name.trim())
    : ['Gavinadmin', 'Gaju'];
  const isAdmin = adminIds.includes(user.id) || adminUsernames.includes(user.username);

  if (!isAdmin) {
    console.log(`[ADMIN] Access DENIED to user-activity for non-admin user: ${user.username} (ID: ${user.id})`);
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Administrator privileges required',
    });
  }

  console.log(`[ADMIN] Dashboard access by user: ${user.username} (ID: ${user.id})`);

  const nodeEnv = process.env.NODE_ENV || 'development';
  const hasReplitDeploymentIndicators = !!(process.env.REPL_SLUG && process.env.REPLIT_RUN_COMMAND);
  const dbUrl = process.env.DATABASE_URL || '';
  const hasProdDatabase =
    dbUrl.includes('prod') ||
    dbUrl.includes('neon.tech') ||
    dbUrl.includes('amazonaws.com') ||
    dbUrl.includes('render.com');
  const isProduction = nodeEnv === 'production';
  const isDevelopment = !isProduction;

  console.log(`Environment detection for user-activity endpoint:`);
  console.log(`- NODE_ENV: ${nodeEnv}`);
  console.log(`- Replit deployment indicators: ${hasReplitDeploymentIndicators}`);
  console.log(`- Production database indicators: ${hasProdDatabase}`);
  console.log(`- Final environment: ${isDevelopment ? 'development' : 'production'}`);

  const envOverride = process.env.FORCE_ENVIRONMENT;
  if (envOverride === 'development' || envOverride === 'production') {
    console.log(`Environment override applied: ${envOverride}`);
  }

  const responseData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isDevelopment ? 'development' : 'production',
    recentRegistrations: [] as RecentRegistration[],
    recentActivity: [] as RecentActivity[],
  };

  try {
    const db = await getDb();
    const environmentValue = isDevelopment ? 'development' : 'production';

    // Get recent registrations
    try {
      const recentRegistrations = await db
        .select({
          username: users.username,
          displayName: users.displayName,
          createdAt: users.createdAt,
          databaseEnvironment: users.environment,
        })
        .from(users)
        .where(eq(users.environment, environmentValue))
        .orderBy(desc(users.createdAt))
        .limit(100);
      responseData.recentRegistrations = recentRegistrations.map((registration) => ({
        username: registration.username,
        displayName: registration.displayName,
        createdAt: formatPostgresTimestamp(registration.createdAt as unknown as string),
        databaseEnvironment: registration.databaseEnvironment,
      }));
    } catch (error) {
      console.error('Error fetching recent registrations:', error);
    }

    // Get recent activity
    try {
      const recentActivity = await db
        .select({
          username: users.username,
          title: movies.title,
          createdAt: watchlistEntries.createdAt,
          status: watchlistEntries.status,
          databaseEnvironment: users.environment,
        })
        .from(watchlistEntries)
        .innerJoin(users, eq(watchlistEntries.userId, users.id))
        .innerJoin(movies, eq(watchlistEntries.movieId, movies.id))
        .where(eq(users.environment, environmentValue))
        .orderBy(desc(watchlistEntries.createdAt))
        .limit(100);
      responseData.recentActivity = recentActivity.map((activity) => ({
        username: activity.username,
        title: activity.title,
        createdAt: formatPostgresTimestamp(activity.createdAt as unknown as string),
        status: activity.status as 'to_watch' | 'watching' | 'watched',
        databaseEnvironment: activity.databaseEnvironment,
      }));
    } catch (error) {
      console.error('Error fetching recent activity:', error);
    }

    res.json(responseData);
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.json({
      status: 'partial',
      timestamp: new Date().toISOString(),
      message: 'Some data could not be loaded',
      recentRegistrations: [],
      recentActivity: [],
    });
  }
});

export const statusRouter = router;