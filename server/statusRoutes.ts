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
router.get('/stats', isJwtAuthenticated, async (_req: Request, res: Response) => {
  try {
    // Get user count
    const users = await storage.getAllUsers();
    const userCount = users.length;
    
    // Get movie count from movies table
    let movieCount = 0;
    try {
      const movieResult = await executeDirectSql<{count: string}>('SELECT COUNT(*) as count FROM movies');
      movieCount = parseInt(movieResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error('Error fetching movie count:', error);
    }
    
    // Get watchlist entry count
    let watchlistCount = 0;
    try {
      const watchlistResult = await executeDirectSql<{count: string}>('SELECT COUNT(*) as count FROM watchlist_entries');
      watchlistCount = parseInt(watchlistResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error('Error fetching watchlist count:', error);
    }
    
    // Get platform count
    let platformCount = 0;
    try {
      const platformResult = await executeDirectSql<{count: string}>('SELECT COUNT(*) as count FROM platforms');
      platformCount = parseInt(platformResult.rows[0]?.count || '0', 10);
    } catch (error) {
      console.error('Error fetching platform count:', error);
    }
    
    // Get top 5 users with most watchlist entries
    let topUsers: {id: number, username: string, display_name: string | null, entry_count: string}[] = [];
    try {
      const topUsersResult = await executeDirectSql<{id: number, username: string, display_name: string | null, entry_count: string}>(`
        SELECT u.id, u.username, u.display_name, COUNT(w.id) as entry_count
        FROM users u
        JOIN watchlist_entries w ON u.id = w.user_id
        GROUP BY u.id, u.username, u.display_name
        ORDER BY entry_count DESC
        LIMIT 5
      `);
      topUsers = topUsersResult.rows;
    } catch (error) {
      console.error('Error fetching top users:', error);
    }
    
    // Get all users with their last activity and watchlist counts
    let userActivity: UserActivityData[] = [];
    try {
      // Get last login time and watchlist count for each user
      type UserActivityQueryData = {
        id: number, 
        username: string, 
        display_name: string | null,
        watchlist_count: string,
        last_login: string | null,
        last_activity: string | null
      };
      
      const userActivityResult = await executeDirectSql<UserActivityQueryData>(`
        SELECT 
          u.id, 
          u.username, 
          u.display_name,
          COUNT(w.id) as watchlist_count,
          (
            SELECT MAX(s.created_at) 
            FROM session s 
            WHERE sess::jsonb->>'preservedUsername' = u.username
            OR sess::jsonb->>'username' = u.username
          ) as last_login,
          (
            SELECT MAX(w2.updated_at) 
            FROM watchlist_entries w2 
            WHERE w2.user_id = u.id
          ) as last_activity
        FROM users u
        LEFT JOIN watchlist_entries w ON u.id = w.user_id
        GROUP BY u.id, u.username, u.display_name
        ORDER BY last_activity DESC NULLS LAST, last_login DESC NULLS LAST
      `);
      userActivity = userActivityResult.rows.map((user: UserActivityQueryData) => ({
        ...user,
        watchlist_count: parseInt(user.watchlist_count, 10),
        last_activity: user.last_activity || user.last_login || null,
        last_seen: user.last_login || null
      }));
    } catch (error) {
      console.error('Error fetching user activity:', error);
    }
    
    // Get database status
    const dbStatus = {
      connected: true,
      lastChecked: new Date().toISOString()
    };
    
    // Get session count
    let sessionCount = 0;
    try {
      const sessionResult = await executeDirectSql('SELECT COUNT(*) as count FROM session');
      sessionCount = sessionResult.rows[0]?.count || 0;
    } catch (error) {
      console.error('Error fetching session count:', error);
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      stats: {
        users: {
          total: userCount,
          topUsers,
          userActivity  // Include all users with their activity data
        },
        content: {
          movies: movieCount,
          watchlistEntries: watchlistCount,
          platforms: platformCount
        },
        system: {
          database: dbStatus,
          sessions: sessionCount
        }
      }
    });
  } catch (error) {
    console.error('Error generating status stats:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to generate system stats',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * Get detailed user statistics (admin only)
 */
router.get('/user-activity', isJwtAuthenticated, async (req: Request, res: Response) => {
  // Verify the user has admin access
  const user = req.user;
  if (!user || user.id !== 1) { // Assuming user ID 1 is the admin for simplicity
    return res.status(403).json({
      status: 'error',
      message: 'Access denied: Admin privilege required'
    });
  }
  
  try {
    // Get recent registrations (last 7 days)
    const recentRegistrations = await executeDirectSql(`
      SELECT username, display_name, created_at
      FROM users
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
    `);
    
    // Get recent watchlist activity
    const recentActivity = await executeDirectSql(`
      SELECT 
        u.username,
        m.title,
        w.created_at,
        w.status
      FROM watchlist_entries w
      JOIN users u ON w.user_id = u.id
      JOIN movies m ON w.movie_id = m.id
      ORDER BY w.created_at DESC
      LIMIT 20
    `);
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      recentRegistrations: recentRegistrations.rows,
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve user activity data',
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

export const statusRouter = router;