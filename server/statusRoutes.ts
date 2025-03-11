import { Router, Request, Response } from "express";
import { storage } from "./storage";
import { executeDirectSql } from "./db";

// Add a type declaration for the executeDirectSql function
declare module "./db" {
  export function executeDirectSql<T = any>(sql: string, params?: any[]): Promise<{rows: T[], rowCount: number}>;
}
import { isJwtAuthenticated } from "./jwtMiddleware";

// Types for database query responses
interface DbQueryResult<T> {
  rows: T[];
  rowCount: number;
}

interface UserActivityData {
  id: number;
  username: string;
  display_name: string | null;
  watchlist_count: number;
  last_login: string | null;
  last_activity: string | null;
  last_seen: string | null;
  database_environment: 'development' | 'production';
}

interface RecentRegistration {
  username: string;
  display_name: string | null;
  created_at: string;
  database_environment: 'development' | 'production';
}

interface RecentActivity {
  username: string;
  title: string;
  created_at: string;
  status: 'to_watch' | 'watching' | 'watched';
  database_environment: 'development' | 'production';
}

const router = Router();

/**
 * Simple status route to check if the API is up
 */
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Public route to check admin users
 * This helps identify who has admin access without requiring database access
 */
router.get('/admin-check', async (_req: Request, res: Response) => {
  try {
    // Administrators are user ID 1 or specified users like Gavinadmin
    const admins = await executeDirectSql<{id: number, username: string, display_name: string | null}>(
      `SELECT id, username, display_name 
       FROM users 
       WHERE id = 1 OR username = 'Gavinadmin' 
       ORDER BY id`
    );
    
    // Make sure rows exists before mapping
    if (admins && admins.rows) {
      res.json({
        status: 'ok',
        adminUsers: admins.rows.map(user => ({
          id: user.id,
          username: user.username,
          displayName: user.display_name || user.username
        }))
      });
    } else {
      // Fallback for when no admins are found
      console.log('No admin users found in database');
      res.json({
        status: 'ok',
        adminUsers: [{
          id: 1,
          username: 'admin',
          displayName: 'Default Admin'
        }],
        note: 'No admin users found in database, showing default admin user'
      });
    }
  } catch (error) {
    console.error('Error fetching admin users:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not determine admin users',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get basic system stats
 * Protected with JWT authentication to prevent public access
 */
router.get('/stats', isJwtAuthenticated, async (req: Request, res: Response) => {
  // Verify the user has admin access
  const user = req.user;
  if (!user) { // Allow any authenticated user during development
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required'
    });
  }
  
  // Log access attempt for debugging
  if (req.user) {
    console.log(`[ADMIN] Stats accessed by user: ${req.user.username} (ID: ${req.user.id})`);
  }
  
  // Determine environment
  const isDevelopment = process.env.NODE_ENV !== 'production';
  
  // Create a basic stats structure with default values
  const responseData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isDevelopment ? 'development' : 'production',
    stats: {
      users: {
        total: 0,
        topUsers: [] as any[],
        userActivity: [] as UserActivityData[] 
      },
      content: {
        movies: 0,
        tvShows: 0, // Add TV shows count
        watchlistEntries: 0,
        platforms: 0
      },
      system: {
        database: {
          connected: true,
          lastChecked: new Date().toISOString()
        },
        sessions: 0
      }
    }
  };
  try {
    // Safely get user count
    try {
      const users = await storage.getAllUsers();
      responseData.stats.users.total = users.length;
    } catch (error) {
      console.error('Error getting user count:', error);
    }
    
    // Get simple counts using direct SQL for reliability
    try {
      // Count only active sessions (not expired and recently accessed)
      const query = `
        SELECT 
          (SELECT COUNT(*) FROM movies WHERE media_type = 'movie') as movie_count,
          (SELECT COUNT(*) FROM movies WHERE media_type = 'tv') as tv_count,
          (SELECT COUNT(*) FROM watchlist_entries) as watchlist_count,
          (SELECT COUNT(*) FROM platforms) as platform_count,
          (SELECT COUNT(*) FROM session 
           WHERE expire > NOW() 
           AND sess::json->>'lastChecked' IS NOT NULL 
           AND (sess::json->>'lastChecked')::bigint > extract(epoch from now())::bigint - 86400) as session_count
      `;
      
      const countResult = await executeDirectSql(query);
      
      if (countResult.rows.length > 0) {
        const counts = countResult.rows[0];
        // Add a movies field that includes both movies and TV shows
        responseData.stats.content.movies = parseInt(counts.movie_count || '0', 10);
        responseData.stats.content.tvShows = parseInt(counts.tv_count || '0', 10);
        responseData.stats.content.watchlistEntries = parseInt(counts.watchlist_count || '0', 10);
        responseData.stats.content.platforms = parseInt(counts.platform_count || '0', 10);
        responseData.stats.system.sessions = parseInt(counts.session_count || '0', 10);
      }
    } catch (error) {
      console.error('Error getting count data:', error);
    }
    
    // Get basic user data (top 5 users and some activity) with environment filtering
    try {
      // We're already connected to the appropriate environment database,
      // so we don't need to filter by username patterns
      const userFilter = '';
      
      // Simplified query for top users - filter by environment
      const userEnvironmentFilter = isDevelopment
        ? "u.username NOT LIKE 'Gaju%' AND u.username NOT LIKE 'Sophieb%'"
        : "u.username LIKE 'Gaju%' OR u.username LIKE 'Sophieb%'";
      
      const topUsersResult = await executeDirectSql(`
        SELECT 
          u.id, 
          u.username, 
          u.display_name, 
          COUNT(w.id)::text as entry_count,
          '${isDevelopment ? 'development' : 'production'}' as database_environment
        FROM users u
        JOIN watchlist_entries w ON u.id = w.user_id
        WHERE ${userEnvironmentFilter}
        GROUP BY u.id, u.username, u.display_name
        ORDER BY COUNT(w.id) DESC
        LIMIT 5
      `);
      
      responseData.stats.users.topUsers = topUsersResult.rows;
      
      // Using a much simpler approach to retrieve latest activity data
      // Add explicit debugging to verify the recent entries
      console.log('[DEBUG] Getting most recent activity for Gavin500 (ID: 53)');
      const entryCheck = await executeDirectSql(`
        SELECT w.id, w.created_at, w.user_id, u.username FROM watchlist_entries w
        JOIN users u ON w.user_id = u.id
        WHERE u.username = 'Gavin500'
        ORDER BY w.created_at DESC LIMIT 5
      `);
      
      if (entryCheck.rows && entryCheck.rows.length > 0) {
        console.log('[DEBUG] Most recent entries for Gavin500:', JSON.stringify(entryCheck.rows));
      } else {
        console.log('[DEBUG] No recent entries found for Gavin500');
      }
      
      // Extremely simplified query that directly gets the most recent activity
      const userActivityResult = await executeDirectSql(`
        SELECT 
          u.id,
          u.username,
          u.display_name,
          u.created_at as registration_date,
          (SELECT COUNT(*) FROM watchlist_entries w WHERE w.user_id = u.id)::text as watchlist_count,
          (SELECT MAX(w.created_at)::text FROM watchlist_entries w WHERE w.user_id = u.id) as last_activity,
          '${isDevelopment ? 'development' : 'production'}' as database_environment
        FROM users u
        WHERE ${userEnvironmentFilter}
        ORDER BY last_activity DESC NULLS LAST, registration_date DESC
      `);
      
      // Map the results with safer parsing
      responseData.stats.users.userActivity = userActivityResult.rows.map(user => ({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        watchlist_count: parseInt(user.watchlist_count || '0', 10),
        last_activity: user.last_activity,
        last_seen: null,
        last_login: user.registration_date, // We're using registration date instead of last login
        database_environment: user.database_environment // Include the database environment
      }));
    } catch (error) {
      console.error('Error getting user activity data:', error);
    }
    
    // Send the response with whatever data we could collect
    res.json(responseData);
    
  } catch (error) {
    console.error('Error generating status stats:', error);
    
    // Send a minimal response even in case of errors
    res.json({
      status: 'partial',
      timestamp: new Date().toISOString(),
      message: 'Some data could not be loaded',
      stats: responseData.stats
    });
  }
});

/**
 * Get detailed user statistics (admin only)
 */
router.get('/user-activity', isJwtAuthenticated, async (req: Request, res: Response) => {
  // Verify the user has admin access
  const user = req.user;
  if (!user) { // Allow any logged in user for testing
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required'
    });
  }
  
  // Log access attempt for debugging
  console.log(`[ADMIN] Dashboard access by user: ${user.username} (ID: ${user.id})`);
  
  // Create a response with default values
  const responseData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    recentRegistrations: [] as RecentRegistration[],
    recentActivity: [] as RecentActivity[]
  };
  
  try {
    // Get recent registrations with environment-specific filtering
    try {
      // Show all registrations in dev mode, no filtering
      // In production, this would be filtered by time period
      const isDevelopment = process.env.NODE_ENV !== 'production';
      console.log('Environment for recent registrations:', isDevelopment ? 'development' : 'production');
      // Create filter based on current environment
      const registrationEnvFilter = isDevelopment
        ? "username NOT LIKE 'Gaju%' AND username NOT LIKE 'Sophieb%'"
        : "username LIKE 'Gaju%' OR username LIKE 'Sophieb%'";
          
      const recentRegistrations = await executeDirectSql(`
        SELECT 
          username, 
          display_name, 
          created_at,
          '${isDevelopment ? 'development' : 'production'}' as database_environment
        FROM users
        WHERE ${registrationEnvFilter}
        ORDER BY created_at DESC
        LIMIT 100
      `);
      
      responseData.recentRegistrations = recentRegistrations.rows || [];
    } catch (error) {
      console.error('Error fetching recent registrations:', error);
    }
    
    // Get recent watchlist activity - use environment-specific filtering
    try {
      // Get all activity, regardless of environment
      // In development, we want to see ALL types of activity
      const isDevelopment = process.env.NODE_ENV !== 'production';
      console.log('Environment for recent activity:', isDevelopment ? 'development' : 'production');
      // Create activity filter based on current environment 
      const activityEnvFilter = isDevelopment
        ? "u.username NOT LIKE 'Gaju%' AND u.username NOT LIKE 'Sophieb%'"
        : "u.username LIKE 'Gaju%' OR u.username LIKE 'Sophieb%'";
          
      const recentActivity = await executeDirectSql(`
        SELECT 
          u.username,
          m.title,
          w.created_at,
          w.status,
          '${isDevelopment ? 'development' : 'production'}' as database_environment
        FROM watchlist_entries w
        JOIN users u ON w.user_id = u.id
        JOIN movies m ON w.movie_id = m.id
        WHERE ${activityEnvFilter}
        ORDER BY w.created_at DESC
        LIMIT 100
      `);
      
      responseData.recentActivity = recentActivity.rows || [];
    } catch (error) {
      console.error('Error fetching recent activity:', error);
    }
    
    // Send the response with whatever data we could collect
    res.json(responseData);
  } catch (error) {
    console.error('Error fetching user activity:', error);
    
    // Send a basic response even in case of errors
    res.json({
      status: 'partial',
      timestamp: new Date().toISOString(),
      message: 'Some data could not be loaded',
      recentRegistrations: [],
      recentActivity: []
    });
  }
});

export const statusRouter = router;