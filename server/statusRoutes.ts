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

// Helper function to format PostgreSQL timestamps to ISO format
function formatPostgresTimestamp(timestamp: string | null): string | null {
  if (!timestamp) return null;
  
  // Remove microseconds and convert to ISO format
  try {
    // Make sure timestamp is a string (handle any potential non-string values)
    const timestampStr = String(timestamp);
    
    // Handle PostgreSQL timestamp format with microseconds
    if (timestampStr.includes('.')) {
      return timestampStr.replace(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}).*/, '$1T$2.000Z');
    }
    
    // Handle timestamps without microseconds
    if (timestampStr.includes(' ') && !timestampStr.includes('T')) {
      return timestampStr.replace(' ', 'T') + '.000Z';
    }
    
    // If it's already in ISO format or close to it
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
router.get('/ping', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Public route to check admin users
 * This helps identify who has admin access without requiring database access
 */
router.get('/admin-check', async (_req: Request, res: Response) => {
  try {
    // Administrators are defined by IDs and/or environment variables
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10)) : [1, 30];
    const adminUsernames = process.env.ADMIN_USERNAMES ? 
      process.env.ADMIN_USERNAMES.split(',').map(name => `'${name.trim()}'`).join(' OR username = ') : 
      "'Gavinadmin' OR username = 'Gaju'";
      
    const admins = await executeDirectSql<{id: number, username: string, display_name: string | null}>(
      `SELECT id, username, display_name 
       FROM users 
       WHERE id IN (${adminIds.join(',')}) OR username = ${adminUsernames}
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
  // Verify the user is authenticated
  const user = req.user;
  if (!user) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required'
    });
  }
  
  // Strict admin access control based on environment variables
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10)) : [1, 30];
  const adminUsernames = process.env.ADMIN_USERNAMES ? 
    process.env.ADMIN_USERNAMES.split(',').map(name => name.trim()) : 
    ['Gavinadmin', 'Gaju'];
    
  // Check if current user is in the admin list
  const isAdmin = adminIds.includes(user.id) || adminUsernames.includes(user.username);
    
  if (!isAdmin) {
    console.log(`[ADMIN] Access DENIED to stats for non-admin user: ${user.username} (ID: ${user.id})`);
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Administrator privileges required'
    });
  }
  
  // Log access attempt for debugging
  if (req.user) {
    console.log(`[ADMIN] Stats accessed by user: ${req.user.username} (ID: ${req.user.id})`);
  }
  
  // Determine environment through multiple environment indicators
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Check multiple indicators to determine the environment:
  // 1. NODE_ENV explicit setting
  // 2. Replit deployment indicators
  // 3. Database connection URL
  
  // Check if we're in a Replit deployment environment
  const hasReplitDeploymentIndicators = !!(process.env.REPL_SLUG && process.env.REPLIT_RUN_COMMAND);
  
  // Check DATABASE_URL for production indicators
  const dbUrl = process.env.DATABASE_URL || '';
  
  // Only consider it a production database if:
  // 1. It explicitly has 'prod' in the URL
  // 2. It's a deployed cloud instance AND NODE_ENV is production
  // This prevents development databases on cloud providers being seen as production
  const hasProdDatabase = 
    dbUrl.includes('prod') || 
    (nodeEnv === 'production' && (
      dbUrl.includes('amazonaws.com') ||
      dbUrl.includes('render.com')
    ));
  
  // For dashboard purposes, we'll force development mode unless:
  // 1. We're explicitly in production mode (NODE_ENV=production)
  // 2. We have an environment variable to override
  
  // Default to development environment for dashboard
  let isDevelopment = true;
  
  // Only consider production if NODE_ENV is explicitly set to production
  const isProduction = nodeEnv === 'production';
  
  // Use that to set the development flag
  isDevelopment = !isProduction;
  
  console.log(`Environment detection for stats endpoint:`);
  console.log(`- NODE_ENV: ${nodeEnv}`);
  console.log(`- Replit deployment indicators: ${hasReplitDeploymentIndicators}`);
  console.log(`- Production database indicators: ${hasProdDatabase}`);
  console.log(`- Final environment: ${isDevelopment ? 'development' : 'production'}`);
  
  // Use environment variable to override if explicitly set
  const envOverride = process.env.FORCE_ENVIRONMENT;
  if (envOverride === 'development' || envOverride === 'production') {
    console.log(`Environment override applied: ${envOverride}`);
    isDevelopment = envOverride === 'development';
  }
  
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
    // Safely get user count - apply environment-specific filtering
    try {
      // Get environment patterns from environment variables to make it configurable
      const devUsernamePattern = process.env.DEV_USERNAME_PATTERN || "'%'";
      const prodUsernamePattern = process.env.PROD_USERNAME_PATTERN || "'%'";
      
      // Create filter based on current environment
      // For backward compatibility, if no pattern is set, use the original exclude/include logic
      // Use the environment column from the database for filtering
      // This provides a clean separation between development and production data
      // The environment column was added to the schema and populated for all users
      const environmentValue = isDevelopment ? "development" : "production";
      
      console.log(`Environment for user count: ${environmentValue}`);
      
      const userCountQuery = `
        SELECT COUNT(*) as user_count
        FROM users
        WHERE environment = '${environmentValue}'
      `;
      
      const userCountResult = await executeDirectSql(userCountQuery);
      responseData.stats.users.total = parseInt(userCountResult.rows[0].user_count || '0', 10);
    } catch (error) {
      console.error('Error getting user count:', error);
    }
    
    // Get simple counts using direct SQL for reliability
    try {
      // Use the same environment detection from above
      // Get environment patterns from environment variables to make it configurable
      const devUsernamePattern = process.env.DEV_USERNAME_PATTERN || "'%'";
      const prodUsernamePattern = process.env.PROD_USERNAME_PATTERN || "'%'";
      
      // Create filter based on current environment
      // For backward compatibility, if no pattern is set, use the original exclude/include logic
      // Use the environment column from the database for filtering content stats
      // This provides a clean separation between development and production data
      const environmentValue = isDevelopment ? "development" : "production";
      
      console.log(`Environment for content stats: ${isDevelopment ? 'development' : 'production'}`);
      
      // Count only active sessions (not expired and recently accessed)
      // Use JOIN with users table to filter watchlist entries and platforms by environment
      const query = `
        SELECT 
          (SELECT COUNT(*) FROM movies m
           JOIN watchlist_entries we ON m.id = we.movie_id
           JOIN users u ON we.user_id = u.id
           WHERE m.media_type = 'movie' AND u.environment = '${environmentValue}'
          ) as movie_count,
          
          (SELECT COUNT(*) FROM movies m
           JOIN watchlist_entries we ON m.id = we.movie_id
           JOIN users u ON we.user_id = u.id
           WHERE m.media_type = 'tv' AND u.environment = '${environmentValue}'
          ) as tv_count,
          
          (SELECT COUNT(*) FROM watchlist_entries we
           JOIN users u ON we.user_id = u.id
           WHERE u.environment = '${environmentValue}'
          ) as watchlist_count,
          
          (SELECT COUNT(*) FROM platforms p
           JOIN users u ON p.user_id = u.id
           WHERE u.environment = '${environmentValue}'
          ) as platform_count,
          
          (SELECT COUNT(*) FROM session 
           WHERE expire > NOW() 
           AND sess::json->>'lastChecked' IS NOT NULL 
           AND (sess::json->>'lastChecked')::bigint > extract(epoch from now())::bigint - 86400
          ) as session_count
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
      
      // Simplified query for top users - reuse the existing environment filter
      // Get environment patterns from environment variables to make it configurable
      const devUsernamePattern = process.env.DEV_USERNAME_PATTERN || "'%'";
      const prodUsernamePattern = process.env.PROD_USERNAME_PATTERN || "'%'";
      
      // Create new filter for user activity based on environment
      // For backward compatibility, if no pattern is set, use the original exclude/include logic
      // Use the environment column from the database for user activity filtering
      // This provides a clean separation between development and production data
      const environmentValue = isDevelopment ? "development" : "production";
      
      const topUsersResult = await executeDirectSql(`
        SELECT 
          u.id, 
          u.username, 
          u.display_name, 
          COUNT(w.id)::text as entry_count,
          '${environmentValue}' as database_environment
        FROM users u
        JOIN watchlist_entries w ON u.id = w.user_id
        WHERE u.environment = '${environmentValue}'
        GROUP BY u.id, u.username, u.display_name
        ORDER BY COUNT(w.id) DESC
        LIMIT 5
      `);
      
      responseData.stats.users.topUsers = topUsersResult.rows;

      const userActivityQuery = `
        SELECT 
          u.id,
          u.username,
          u.display_name,
          u.created_at as registration_date,
          (SELECT COUNT(*) FROM watchlist_entries w WHERE w.user_id = u.id)::text as watchlist_count,
          (SELECT MAX(w.created_at)::text FROM watchlist_entries w WHERE w.user_id = u.id) as last_activity,
          '${environmentValue}' as database_environment
        FROM users u
        WHERE u.environment = '${environmentValue}'
        ORDER BY last_activity DESC NULLS LAST, registration_date DESC
      `;
      
      const userActivityResult = await executeDirectSql(userActivityQuery);
      
      // Map the results with safer parsing and consistent date formatting
      responseData.stats.users.userActivity = userActivityResult.rows.map(user => ({
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        watchlist_count: parseInt(user.watchlist_count || '0', 10),
        last_activity: formatPostgresTimestamp(user.last_activity),
        last_seen: null,
        last_login: formatPostgresTimestamp(user.registration_date), // We're using registration date instead of last login
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
  // Verify the user is authenticated
  const user = req.user;
  if (!user) {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Authentication required'
    });
  }
  
  // Strict admin access control based on environment variables
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim(), 10)) : [1, 30];
  const adminUsernames = process.env.ADMIN_USERNAMES ? 
    process.env.ADMIN_USERNAMES.split(',').map(name => name.trim()) : 
    ['Gavinadmin', 'Gaju'];
    
  // Check if current user is in the admin list
  const isAdmin = adminIds.includes(user.id) || adminUsernames.includes(user.username);
    
  if (!isAdmin) {
    console.log(`[ADMIN] Access DENIED to user-activity for non-admin user: ${user.username} (ID: ${user.id})`);
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Administrator privileges required'
    });
  }
  
  // Log access attempt for debugging
  console.log(`[ADMIN] Dashboard access by user: ${user.username} (ID: ${user.id})`);
  
  // Determine environment through multiple environment indicators
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Check multiple indicators to determine the environment:
  // 1. NODE_ENV explicit setting
  // 2. Replit deployment indicators
  // 3. Database connection URL
  
  // Check if we're in a Replit deployment environment
  const hasReplitDeploymentIndicators = !!(process.env.REPL_SLUG && process.env.REPLIT_RUN_COMMAND);
  
  // Check DATABASE_URL for production indicators
  const dbUrl = process.env.DATABASE_URL || '';
  const hasProdDatabase = dbUrl.includes('prod') || 
                          dbUrl.includes('neon.tech') || 
                          dbUrl.includes('amazonaws.com') ||
                          dbUrl.includes('render.com');
  
  // For dashboard purposes in development, we'll only be in production mode
  // if NODE_ENV is explicitly set to production
  
  // Always default to development mode for dashboard 
  // unless explicitly set to production mode
  const isProduction = nodeEnv === 'production';
  let isDevelopment = !isProduction;
  
  console.log(`Environment detection for user-activity endpoint:`);
  console.log(`- NODE_ENV: ${nodeEnv}`);
  console.log(`- Replit deployment indicators: ${hasReplitDeploymentIndicators}`);
  console.log(`- Production database indicators: ${hasProdDatabase}`);
  console.log(`- Final environment: ${isDevelopment ? 'development' : 'production'}`);
  
  // Use environment variable to override if explicitly set
  const envOverride = process.env.FORCE_ENVIRONMENT;
  if (envOverride === 'development' || envOverride === 'production') {
    console.log(`Environment override applied: ${envOverride}`);
    isDevelopment = envOverride === 'development';
  }
  
  // Create a response with default values
  const responseData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: isDevelopment ? 'development' : 'production', // Add environment to the response
    recentRegistrations: [] as RecentRegistration[],
    recentActivity: [] as RecentActivity[]
  };
  
  try {
    // Get recent registrations with environment-specific filtering
    try {
      // Show all registrations in dev mode, no filtering
      // In production, this would be filtered by time period
      console.log('Environment for recent registrations:', isDevelopment ? 'development' : 'production');
      // Use environment variables for configuration instead of hardcoded patterns
      // To configure development vs. production data separation:
      // - Set DEV_USERNAME_PATTERN to filter usernames in development (e.g., "'dev_%'" to show only dev_ prefixed users)
      // - Set PROD_USERNAME_PATTERN to filter usernames in production (e.g., "'prod_%'" to show only prod_ prefixed users)
      // By default, all users are shown in both environments if not configured
      
      // For now, get environment patterns from environment variables to make it configurable
      const devUsernamePattern = process.env.DEV_USERNAME_PATTERN || "'%'";
      const prodUsernamePattern = process.env.PROD_USERNAME_PATTERN || "'%'";
      
      // Create filter based on current environment
      // For backward compatibility, if no pattern is set, use the original exclude/include logic
      // Use the environment column from the database for user registrations filtering
      // This provides a clean separation between development and production data
      const environmentValue = isDevelopment ? "development" : "production";
          
      const recentRegistrations = await executeDirectSql(`
        SELECT 
          username, 
          display_name, 
          created_at,
          '${environmentValue}' as database_environment
        FROM users
        WHERE environment = '${environmentValue}'
        ORDER BY created_at DESC
        LIMIT 100
      `);
      
      // Format registration timestamps
      responseData.recentRegistrations = (recentRegistrations.rows || []).map(registration => ({
        ...registration,
        created_at: formatPostgresTimestamp(registration.created_at)
      }));
    } catch (error) {
      console.error('Error fetching recent registrations:', error);
    }
    
    // Get recent watchlist activity - use environment-specific filtering
    try {
      // Get all activity, regardless of environment
      // In development, we want to see ALL types of activity
      console.log('Environment for recent activity:', isDevelopment ? 'development' : 'production');
      // Get environment patterns from environment variables to make it configurable
      const devUsernamePattern = process.env.DEV_USERNAME_PATTERN || "'%'";
      const prodUsernamePattern = process.env.PROD_USERNAME_PATTERN || "'%'";
      
      // Create filter based on current environment 
      // For backward compatibility, if no pattern is set, use the original exclude/include logic
      // Use the environment column from the database for recent activity filtering
      // This provides a clean separation between development and production data
      const environmentValue = isDevelopment ? "development" : "production";
          
      const recentActivity = await executeDirectSql(`
        SELECT 
          u.username,
          m.title,
          w.created_at,
          w.status,
          '${environmentValue}' as database_environment
        FROM watchlist_entries w
        JOIN users u ON w.user_id = u.id
        JOIN movies m ON w.movie_id = m.id
        WHERE u.environment = '${environmentValue}'
        ORDER BY w.created_at DESC
        LIMIT 100
      `);
      
      // Format timestamps consistently
      responseData.recentActivity = (recentActivity.rows || []).map(activity => ({
        ...activity,
        created_at: formatPostgresTimestamp(activity.created_at)
      }));
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