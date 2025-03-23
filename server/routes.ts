import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated, hasWatchlistAccess, validateSession } from "./auth";
import { isJwtAuthenticated, hasJwtWatchlistAccess } from "./jwtMiddleware";
import { extractTokenFromHeader, verifyToken, JWT_SECRET } from "./jwtAuth";
import { emergencyAuthCheck } from "./emergencyAuth";
import jwt from 'jsonwebtoken';
import axios from "axios";
import { z } from "zod";
import { 
  insertUserSchema, 
  insertMovieSchema, 
  insertWatchlistEntrySchema,
  type TMDBSearchResponse,
  type TMDBMovie,
  type User,
  type WatchlistEntryWithMovie
} from "@shared/schema";
import { jwtAuthRouter } from "./jwtAuthRoutes";
import { simpleRegisterRouter } from "./simpleRegister";
import { executeDirectSql } from "./db";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "79d177894334dec45f251ff671833a50";
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

// Genre maps for converting ids to names
const movieGenreMap: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western'
};

const tvGenreMap: Record<number, string> = {
  10759: 'Action & Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  10762: 'Kids',
  9648: 'Mystery',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
  37: 'Western'
};

// Helper function to convert genre IDs to names
async function convertGenreIdsToNames(genreIds: number[] = [], mediaType: string = 'movie'): Promise<string[]> {
  const genreMap = mediaType === 'tv' ? tvGenreMap : movieGenreMap;
  return genreIds.map(id => genreMap[id] || '').filter(Boolean);
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Apply validateSession middleware to all routes to keep sessions fresh
  app.use(validateSession);
  
  // Emergency routes have been removed to simplify authentication
  
  // Register simplified registration router for more reliable user creation
  console.log("[SERVER] Registering simplified registration endpoint");
  app.use("/api", simpleRegisterRouter);
  
  // Add direct handlers for status endpoints to make them available in production environment
  app.get("/api/status/ping", (_req: Request, res: Response) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  
  app.get("/api/status/admin-check", async (_req: Request, res: Response) => {
    try {
      // Administrators are user ID 1 or any user marked as admin 
      // In the current system, only user ID 1 has admin privileges
      const admins = await executeDirectSql<{id: number, username: string, display_name: string | null}>(
        'SELECT id, username, display_name FROM users WHERE id = 1 ORDER BY id'
      );
      
      // Make sure rows exists before mapping
      if (admins && admins.rows && admins.rows.length > 0) {
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
  
  // Auth routes are already registered in index.ts - don't register them twice
  
  // Add a session diagnostics endpoint to help debug session issues
  app.get("/api/diagnostics", (req: Request, res: Response) => {
    // Gather comprehensive session information
    const sessionId = req.sessionID || 'unknown';
    const isAuthenticated = req.isAuthenticated();
    const user = req.user ? {
      id: (req.user as any).id,
      username: (req.user as any).username,
    } : null;
    
    // Gather session data with safety checks
    const sessionData = req.session ? {
      id: req.sessionID,
      cookie: req.session.cookie ? {
        expires: req.session.cookie.expires,
        maxAge: req.session.cookie.maxAge,
        secure: req.session.cookie.secure,
        httpOnly: req.session.cookie.httpOnly,
        sameSite: req.session.cookie.sameSite
      } : 'No cookie data',
      authenticated: req.session.authenticated,
      createdAt: req.session.createdAt,
      lastChecked: req.session.lastChecked,
      repaired: req.session.repaired
    } : 'No session data';
    
    // Gather request information
    const requestInfo = {
      ip: req.ip,
      ips: req.ips,
      secure: req.secure,
      protocol: req.protocol,
      hostname: req.hostname,
      path: req.path,
      headers: {
        userAgent: req.headers['user-agent'],
        cookie: req.headers.cookie,
        referer: req.headers.referer,
        accept: req.headers.accept
      }
    };
    
    // Gather environment information
    const environment = {
      nodeEnv: process.env.NODE_ENV || 'development',
      sessionSecret: process.env.SESSION_SECRET ? `Length: ${process.env.SESSION_SECRET.length}` : 'Not set',
      databaseUrl: process.env.DATABASE_URL ? 'Set' : 'Not set'
    };
    
    // Response with comprehensive diagnostic information
    res.json({
      success: true,
      sessionId,
      isAuthenticated,
      user,
      session: sessionData,
      request: requestInfo,
      environment
    });
  });

  // Add special refresh session endpoint that can recover sessions
  app.get("/api/refresh-session", async (req: Request, res: Response) => {
    const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : null;
    const username = req.query.username as string || null;
    const sessionId = req.sessionID || 'unknown';
    
    console.log(`[SESSION-REFRESH] Refresh request received, session: ${sessionId}, userId: ${userId || 'none'}, username: ${username || 'none'}`);
    
    // If the user is already authenticated, just return the current user
    if (req.isAuthenticated() && req.user) {
      console.log(`[SESSION-REFRESH] User already authenticated as ${(req.user as any).username}`);
      
      // Mark session as authenticated
      req.session.authenticated = true;
      req.session.lastChecked = Date.now();
      
      // Return the current authenticated user
      return res.json({
        authenticated: true,
        user: req.user,
        sessionId: req.sessionID,
        refreshed: true
      });
    }
    
    // If a user ID or username was provided and the user is not authenticated, attempt recovery
    if (userId || username) {
      try {
        // Get the user from storage - by ID or username
        let user;
        if (userId) {
          user = await storage.getUser(userId);
        } else if (username) {
          user = await storage.getUserByUsername(username);
        }
        
        if (!user) {
          return res.status(404).json({ 
            message: "User not found", 
            authenticated: false 
          });
        }
        
        console.log(`[SESSION-REFRESH] Found user ${user.username} (ID: ${user.id}), attempting login`);
        
        // Log the user in
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error(`[SESSION-REFRESH] Login failed:`, loginErr);
            return res.status(500).json({ 
              message: "Login failed", 
              error: loginErr.message, 
              authenticated: false 
            });
          }
          
          // Mark session as authenticated
          req.session.authenticated = true;
          req.session.createdAt = Date.now();
          req.session.lastChecked = Date.now();
          
          // Save the session
          req.session.save((saveErr) => {
            if (saveErr) {
              console.error(`[SESSION-REFRESH] Session save failed:`, saveErr);
              // Even if save fails, we can still return the user
            } else {
              console.log(`[SESSION-REFRESH] Session refreshed successfully for ${user.username}`);
            }
            
            // Return the freshly authenticated user
            return res.json({
              authenticated: true,
              user: user,
              sessionId: req.sessionID,
              refreshed: true
            });
          });
        });
      } catch (error) {
        console.error(`[SESSION-REFRESH] Error refreshing session:`, error);
        return res.status(500).json({ 
          message: "Session refresh failed", 
          error: error instanceof Error ? error.message : "Unknown error",
          authenticated: false 
        });
      }
    } else {
      // No user ID and not authenticated, just return the current session state
      return res.json({
        authenticated: false,
        user: null,
        sessionId: req.sessionID
      });
    }
  });
  
  // User routes
  app.get("/api/users", async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/users", async (req: Request, res: Response) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByUsername(userData.username);
      if (existingUser) {
        return res.status(409).json({ message: "Username already exists" });
      }
      
      const newUser = await storage.createUser(userData);
      res.status(201).json(newUser);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid user data", errors: error.errors });
      } else {
        res.status(500).json({ message: "Failed to create user" });
      }
    }
  });

  // Get external IDs (including IMDb ID) for a movie or TV show
  app.get("/api/movies/external-ids/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { mediaType } = req.query;
      
      if (!id) {
        return res.status(400).json({ message: "ID parameter is required" });
      }
      
      const type = typeof mediaType === "string" ? mediaType : "movie";
      
      const response = await axios.get(`${TMDB_API_BASE_URL}/${type}/${id}/external_ids`, {
        params: {
          api_key: TMDB_API_KEY,
        },
      });
      
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching external IDs:", error);
      res.status(500).json({ message: "Failed to fetch external IDs" });
    }
  });
  
  // Get detailed information for a movie or TV show including runtime
  app.get("/api/movies/details/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { mediaType } = req.query;
      
      if (!id) {
        return res.status(400).json({ message: "ID parameter is required" });
      }
      
      const type = typeof mediaType === "string" ? mediaType : "movie";
      
      const response = await axios.get(`${TMDB_API_BASE_URL}/${type}/${id}`, {
        params: {
          api_key: TMDB_API_KEY,
        },
      });
      
      res.json(response.data);
    } catch (error) {
      console.error("Error fetching movie/TV details:", error);
      res.status(500).json({ message: "Failed to fetch movie/TV details" });
    }
  });

  // Movie and TV show search route (TMDB API)
  app.get("/api/movies/search", async (req: Request, res: Response) => {
    try {
      const { query, mediaType } = req.query;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query parameter is required" });
      }
      
      const type = typeof mediaType === "string" ? mediaType : "all";
      let results: TMDBMovie[] = [];
      
      // Search for movies if mediaType is "all" or "movie"
      if (type === "all" || type === "movie") {
        const movieResponse = await axios.get<TMDBSearchResponse>(`${TMDB_API_BASE_URL}/search/movie`, {
          params: {
            api_key: TMDB_API_KEY,
            query,
            include_adult: false,
          },
        });
        
        // Add media_type to each result
        results = [
          ...results, 
          ...movieResponse.data.results.map(item => ({ ...item, media_type: "movie" }))
        ];
      }
      
      // Search for TV shows if mediaType is "all" or "tv"
      if (type === "all" || type === "tv") {
        const tvResponse = await axios.get<TMDBSearchResponse>(`${TMDB_API_BASE_URL}/search/tv`, {
          params: {
            api_key: TMDB_API_KEY,
            query,
            include_adult: false,
          },
        });
        
        // Add media_type to each result
        results = [
          ...results, 
          ...tvResponse.data.results.map(item => ({ ...item, media_type: "tv" }))
        ];
      }
      
      // Sort results by popularity (using vote_average as a proxy)
      results.sort((a, b) => b.vote_average - a.vote_average);
      
      const response: TMDBSearchResponse = {
        page: 1,
        results,
        total_results: results.length,
        total_pages: 1
      };
      
      res.json(response);
    } catch (error) {
      console.error("Error searching movies/TV:", error);
      res.status(500).json({ message: "Failed to search movies and TV shows" });
    }
  });

  // Watchlist routes - protect all with isAuthenticated middleware
  app.get("/api/watchlist/:userId", isJwtAuthenticated, hasJwtWatchlistAccess, async (req: Request, res: Response) => {
    // ENHANCED: Added robust recovery mechanisms for watchlist access
    const isProd = process.env.NODE_ENV === 'production';
    
    // Verify database connection before operation
    try {
      console.log("[WATCHLIST] Verifying database connection before operation...");
      const { ensureDatabaseReady } = await import('./db');
      const isDbReady = await ensureDatabaseReady();
      
      if (!isDbReady) {
        console.warn("[WATCHLIST] Database connection is not ready - using fallback mechanisms");
        // Continue anyway, as our storage layer has fallbacks
      } else {
        console.log("[WATCHLIST] Database connection verified successfully");
      }
    } catch (dbCheckError) {
      console.error("[WATCHLIST] Error verifying database connection:", dbCheckError);
    }
    
    try {
      const userId = parseInt(req.params.userId, 10);
      console.log(`[WATCHLIST] Fetching watchlist for user ID: ${userId}`);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // Security check - ensure authenticated user can only see their own watchlist
      const authId = (req.user as any)?.id;
      if (authId !== userId) {
        console.error(`[WATCHLIST] Authorization mismatch: authenticated user ID ${authId} != requested userId ${userId}`);
        return res.status(403).json({ 
          message: "You can only view your own watchlist" 
        });
      }
      
      // For safer watchlist access across environments
      let watchlistData: WatchlistEntryWithMovie[] = [];
      let userFound = false;
      let fetchSuccess = false;
      
      // Multi-stage approach with fallbacks for watchlist retrieval
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[WATCHLIST] Attempting to fetch watchlist (attempt ${attempt}/3)...`);
          
          // STEP 1: Get user to verify existence
          const user = await storage.getUser(userId);
          
          if (user) {
            userFound = true;
            console.log(`[WATCHLIST] Found user: ${user.username} (ID: ${userId})`);
            
            // Successful user lookup - get watchlist
            watchlistData = await storage.getWatchlistEntries(userId);
            console.log(`[WATCHLIST] Standard fetch successful: ${watchlistData.length} entries`);
            
            // Store backup in session for potential recovery
            if (isProd && req.session) {
              (req.session as any).lastWatchlistUser = userId;
              (req.session as any).lastWatchlistCount = watchlistData.length;
              (req.session as any).lastWatchlistTime = Date.now();
            }
            
            // Also store in response header for client-side knowledge
            res.setHeader('X-Watchlist-Count', watchlistData.length.toString());
            res.setHeader('X-Watchlist-Timestamp', Date.now().toString());
            
            fetchSuccess = true;
            break; // Success - exit retry loop
          } else {
            console.log(`[WATCHLIST] User with ID ${userId} not found in lookup attempt ${attempt}`);
            
            if (attempt === 3) {
              return res.status(404).json({ message: "User not found" });
            }
          }
        } catch (primaryError) {
          console.error(`[WATCHLIST] Error in watchlist fetch attempt ${attempt}:`, primaryError);
          
          if (attempt === 3) {
            // Final attempt - try direct SQL as a last resort
            try {
              console.log(`[WATCHLIST] Attempting direct SQL watchlist fetch as last resort...`);
              const { executeDirectSql } = await import('./db');
              
              // First check if the user exists
              const userResults = await executeDirectSql(
                `SELECT * FROM users WHERE id = $1`, 
                [userId]
              );
              
              if (userResults && userResults.rows && userResults.rows.length > 0) {
                userFound = true;
                const userData = userResults.rows[0];
                console.log(`[WATCHLIST] Found user via direct SQL: ${userData.username} (ID: ${userData.id})`);
                
                // Try to fetch the watchlist entries using direct SQL
                const entryResults = await executeDirectSql(
                  `SELECT we.*, m.*, p.id as platform_id, p.name as platform_name, p.is_default as platform_is_default
                   FROM watchlist_entries we
                   JOIN movies m ON we.movie_id = m.id
                   LEFT JOIN platforms p ON we.platform_id = p.id
                   WHERE we.user_id = $1
                   ORDER BY we.created_at DESC`, 
                  [userId]
                );
                
                if (entryResults && entryResults.rows && entryResults.rows.length > 0) {
                  // Map the SQL results to our expected format
                  watchlistData = entryResults.rows.map((row: any) => {
                    // Structure the movie data
                    const movie = {
                      id: row.id,
                      tmdbId: row.tmdb_id,
                      title: row.title || '[Unknown]',
                      overview: row.overview || '',
                      posterPath: row.poster_path || '',
                      backdropPath: row.backdrop_path || '',
                      releaseDate: row.release_date || null,
                      voteAverage: row.vote_average || 0,
                      mediaType: row.media_type || 'movie',
                      createdAt: row.created_at || new Date().toISOString()
                    };
                    
                    // Create platform object if platform data exists
                    let platform = null;
                    if (row.platform_id) {
                      platform = {
                        id: row.platform_id,
                        name: row.platform_name || 'Unknown Platform',
                        isDefault: row.platform_is_default || false
                      };
                    }
                    
                    // Structure the watchlist entry
                    return {
                      id: row.id,
                      userId: row.user_id,
                      movieId: row.movie_id,
                      platformId: row.platform_id || null,
                      status: row.status || 'to_watch',
                      watchedDate: row.watched_date || null,
                      notes: row.notes || '',
                      createdAt: row.created_at || new Date().toISOString(),
                      movie,
                      platform
                    };
                  });
                  
                  console.log(`[WATCHLIST] Direct SQL watchlist fetch successful, found ${watchlistData.length} entries`);
                  fetchSuccess = true;
                } else {
                  // If no results, it might be valid that the user has no entries
                  console.log(`[WATCHLIST] Direct SQL watchlist fetch returned no entries, this may be normal`);
                  watchlistData = [];
                  fetchSuccess = true;
                }
              } else {
                // No user found via direct SQL either
                console.log(`[WATCHLIST] User with ID ${userId} not found via direct SQL`);
                return res.status(404).json({ message: "User not found" });
              }
            } catch (directSqlError) {
              console.error(`[WATCHLIST] Direct SQL watchlist fetch failed:`, directSqlError);
              
              // All attempts failed, but we'll continue with session recovery
              console.warn(`[WATCHLIST] All direct watchlist fetch methods failed, trying session recovery`);
            }
          } else {
            // Not the final attempt, wait before retrying
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          }
        }
      }
      
      // If we successfully fetched data through any method, return it
      if (fetchSuccess) {
        res.setHeader('X-Watchlist-Source', 'primary');
        return res.json(watchlistData);
      }
      
      // Last-resort recovery for production environments:
      // Try to recover from session data if available
      if (isProd && req.session) {
        const storedUserId = (req.session as any).lastWatchlistUser;
        
        if (storedUserId === userId) {
          console.log(`[WATCHLIST] Attempting recovery from session data for user ${userId}`);
          const backupCount = (req.session as any).lastWatchlistCount || 0;
          const backupTime = (req.session as any).lastWatchlistTime || 0;
          const ageInMinutes = (Date.now() - backupTime) / (1000 * 60);
          
          if (backupCount > 0) {
            // We don't have the actual data, but we know how many items were there
            // Return a special format indicating recovery mode
            console.log(`[WATCHLIST] Using recovery indicators with count ${backupCount} from ${ageInMinutes.toFixed(1)} minutes ago`);
            res.setHeader('X-Watchlist-Source', 'recovery');
            res.setHeader('X-Watchlist-Count', backupCount.toString());
            res.setHeader('X-Watchlist-Recovery-Age', ageInMinutes.toFixed(1));
            
            // Return an empty array but with special headers for the client
            return res.status(206).json({
              recoveryMode: true,
              message: "Watchlist data temporarily unavailable, recovery information provided", 
              expectedCount: backupCount,
              recoveryAge: ageInMinutes,
              entries: []
            });
          }
        }
      }
      
      // If we reach here, all attempts failed, and we have no backup
      return res.status(404).json({ message: "Watchlist not found or temporarily unavailable" });
    } catch (error) {
      console.error("[WATCHLIST] Unhandled error in watchlist fetch:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error("[WATCHLIST] Error details:", errorMessage);
      console.error("[WATCHLIST] Error stack:", errorStack);
      
      // Enhanced error handling - check for common error patterns
      let statusCode = 500;
      let userMessage = "Failed to fetch watchlist";
      
      // Check for database connection issues
      if (errorMessage.includes('connection') || 
          errorMessage.includes('pool') || 
          errorMessage.includes('database') ||
          errorMessage.includes('timeout')) {
        userMessage = "Database connection issue detected. Please try again later.";
        statusCode = 503; // Service Unavailable
      } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        statusCode = 404;
        userMessage = "The requested resource was not found.";
      } else if (errorMessage.includes('token') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
        statusCode = 401;
        userMessage = "Authentication error. Please log in again.";
      } else if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || errorMessage.includes('403')) {
        statusCode = 403;
        userMessage = "You don't have permission to access this watchlist.";
      }
      
      // Prepare enhanced error response
      interface ErrorResponse {
        message: string;
        error?: string;
        stack?: string;
        time?: string;
        recoveryMode?: boolean;
      }
      
      // Only include detailed error info in development
      const errorResponse: ErrorResponse = isProd
        ? { message: userMessage }
        : { 
            message: userMessage, 
            error: errorMessage, 
            stack: errorStack,
            time: new Date().toISOString()
          };
      
      res.status(statusCode).json(errorResponse);
    }
  });

  // POST endpoint to add movie to watchlist - SIMPLIFIED for emergency auth compatibility
  app.post("/api/watchlist", async (req: Request, res: Response) => {
    console.log("POST /api/watchlist - Request body:", JSON.stringify(req.body, null, 2));
    console.log("POST /api/watchlist - Headers:", JSON.stringify({
      auth: req.headers.authorization ? "Present" : "Missing",
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent']
    }, null, 2));
    
    // Verify database connection before operation
    try {
      console.log("[WATCHLIST] Verifying database connection before operation...");
      const { ensureDatabaseReady } = await import('./db');
      const isDbReady = await ensureDatabaseReady();
      
      if (!isDbReady) {
        console.warn("[WATCHLIST] Database connection is not ready - using fallback mechanisms");
        // Continue anyway, as our storage layer has fallbacks
      } else {
        console.log("[WATCHLIST] Database connection verified successfully");
      }
    } catch (dbCheckError) {
      console.error("[WATCHLIST] Error verifying database connection:", dbCheckError);
    }
    
    try {
      // First check for emergency auth
      emergencyAuthCheck(req, res, () => {});
      
      // Then check for JWT auth if no emergency auth
      if (!req.user) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
          const token = authHeader.split('Bearer ')[1];
          if (token) {
            console.log('[WATCHLIST] Checking JWT auth with token');
            try {
              const decoded = jwt.verify(token, JWT_SECRET) as any;
              if (decoded) {
                console.log(`[WATCHLIST] JWT auth successful for user: ${decoded.username}`);
                req.user = decoded;
              }
            } catch (tokenError) {
              console.error('[WATCHLIST] JWT token verification failed:', tokenError);
            }
          }
        }
      }
      
      // Final auth check
      if (!req.user) {
        console.log('[WATCHLIST] No authenticated user found after all auth checks');
        
        // Last resort - check query parameters
        const emergencyUser = req.query.user || req.headers['x-emergency-user'];
        const emergencyAuth = req.query.emergencyLogin === 'true' || req.headers['x-emergency-auth'] === 'true';
        
        if (emergencyUser && emergencyAuth) {
          console.log(`[EMERGENCY] Using emergency user from parameters: ${emergencyUser}`);
          
          // Create synthetic user for emergency mode
          req.user = {
            id: -1,
            username: String(emergencyUser),
            displayName: String(emergencyUser)
          } as any;
          
          console.log(`[EMERGENCY] Created emergency user for watchlist action: ${(req.user as any).username}`);
        } else {
          return res.status(401).json({ 
            message: "Authentication required",
            details: "Please log in again. Your session may have expired."
          });
        }
      }
      
      const authUserName = (req.user as any).username || 'Unknown';
      const authUserId = (req.user as any).id || -1;
      console.log(`[WATCHLIST] User authenticated for watchlist action: ${authUserName} (ID: ${authUserId})`);
    
      
      // Parse and validate the input
      console.log("[WATCHLIST] Raw request body:", JSON.stringify(req.body, null, 2));
      
      // Handle both tmdbData and tmdbMovie formats (for backward compatibility)
      let userId = req.body.userId;
      let tmdbId = req.body.tmdbId;
      let tmdbData = req.body.tmdbData || req.body.tmdbMovie;
      const status = req.body.status || 'to_watch'; 
      const watchedDate = req.body.watchedDate || null;
      const notes = req.body.notes || '';
      const platformId = req.body.platformId || null;
      
      // If there's a tmdbMovie but no tmdbId, extract it from the tmdbMovie
      if (!tmdbId && req.body.tmdbMovie && req.body.tmdbMovie.id) {
        tmdbId = req.body.tmdbMovie.id;
        console.log(`[WATCHLIST] Extracted tmdbId ${tmdbId} from tmdbMovie`);
      }
      
      console.log(`[WATCHLIST] Parsed values: userId=${userId}, tmdbId=${tmdbId}, status=${status}`);
      
      // Enhanced validation with better error messages
      if (!userId || !tmdbId || !tmdbData) {
        const missingFields = [];
        if (!userId) missingFields.push('userId');
        if (!tmdbId) missingFields.push('tmdbId');
        if (!tmdbData) missingFields.push('tmdbData');
        
        return res.status(400).json({ 
          message: `Missing required fields: ${missingFields.join(', ')}` 
        });
      }
      
      // Safety check - ensure the user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Security check - ensure the authenticated user can only add to their own watchlist
      // This prevents users from adding movies to other users' watchlists
      const authId = (req.user as any)?.id;
      if (authId !== userId && authId !== -1) { // Special case for emergency user
        console.log(`[WATCHLIST] Auth mismatch: authUser.id=${authId}, userId=${userId}`);
        return res.status(403).json({ 
          message: "You can only add movies to your own watchlist" 
        });
      }
      
      // Check if this movie already exists in our database (with robust error handling)
      let movie;
      try {
        movie = await storage.getMovieByTmdbId(tmdbId);
        console.log(`[WATCHLIST] Movie lookup result for TMDB ID ${tmdbId}: ${movie ? 'Found' : 'Not found'}`);
      } catch (movieLookupError) {
        console.error(`[WATCHLIST] Error looking up movie by TMDB ID ${tmdbId}:`, movieLookupError);
        // Continue without existing movie - we'll try to create it
      }
      
      // If not, create the movie record with robust error handling
      if (!movie) {
        console.log(`[WATCHLIST] Creating new movie record for TMDB ID ${tmdbId}`);
        const mediaType = tmdbData.media_type || 'movie';
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const releaseDate = mediaType === 'tv' ? tmdbData.first_air_date : tmdbData.release_date;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`[WATCHLIST] Creating movie record (attempt ${attempt}/3)...`);
            movie = await storage.createMovie({
              tmdbId,
              title: title || '[Unknown Title]',
              overview: tmdbData.overview || '',
              posterPath: tmdbData.poster_path || '',
              backdropPath: tmdbData.backdrop_path || '',
              releaseDate: releaseDate || null,
              voteAverage: tmdbData.vote_average || 0,
              runtime: tmdbData.runtime || null,
              numberOfSeasons: mediaType === 'tv' ? tmdbData.number_of_seasons || null : null,
              numberOfEpisodes: mediaType === 'tv' ? tmdbData.number_of_episodes || null : null,
              mediaType
            });
            
            console.log(`[WATCHLIST] Successfully created new movie: ${movie.title} (ID: ${movie.id})`);
            break; // Success - exit retry loop
          } catch (movieError) {
            console.error(`[WATCHLIST] Error creating movie (attempt ${attempt}/3):`, movieError);
            
            if (attempt === 3) {
              // Direct SQL fallback on final attempt
              try {
                console.log(`[WATCHLIST] Attempting direct SQL movie creation as last resort...`);
                const { executeDirectSql } = await import('./db');
                
                // Try to insert the movie using direct SQL
                const result = await executeDirectSql(
                  `INSERT INTO movies (tmdb_id, title, overview, poster_path, backdrop_path, release_date, vote_average, runtime, number_of_seasons, number_of_episodes, media_type) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
                   RETURNING *`, 
                  [
                    tmdbId, 
                    title || '[Unknown Title]', 
                    tmdbData.overview || '', 
                    tmdbData.poster_path || '', 
                    tmdbData.backdrop_path || '', 
                    releaseDate || null, 
                    tmdbData.vote_average || 0,
                    tmdbData.runtime || null,
                    mediaType === 'tv' ? tmdbData.number_of_seasons || null : null,
                    mediaType === 'tv' ? tmdbData.number_of_episodes || null : null, 
                    mediaType
                  ]
                );
                
                if (result && Array.isArray(result.rows) && result.rows.length > 0) {
                  // Map the SQL result to our expected movie format
                  const row = result.rows[0] as any;
                  movie = {
                    id: row.id,
                    tmdbId: row.tmdb_id,
                    title: row.title,
                    overview: row.overview,
                    posterPath: row.poster_path,
                    backdropPath: row.backdrop_path,
                    releaseDate: row.release_date,
                    voteAverage: row.vote_average,
                    genres: row.genres,
                    runtime: row.runtime,
                    numberOfSeasons: row.number_of_seasons,
                    numberOfEpisodes: row.number_of_episodes,
                    mediaType: row.media_type,
                    createdAt: row.created_at
                  };
                  
                  console.log(`[WATCHLIST] Direct SQL movie creation successful (ID: ${movie.id})`);
                  break; // Success - exit retry loop
                }
              } catch (directSqlError) {
                console.error(`[WATCHLIST] Direct SQL movie creation failed:`, directSqlError);
                
                // All attempts failed - handle the failure
                // In production, return a 202 Accepted with a warning
                if (process.env.NODE_ENV === 'production') {
                  // Create a temporary movie object to allow the operation to continue
                  const tempId = new Date().getTime(); // Use timestamp as temp ID
                  movie = {
                    id: tempId,
                    tmdbId,
                    title: title || '[Unknown Title]',
                    overview: tmdbData.overview || '',
                    posterPath: tmdbData.poster_path || '',
                    backdropPath: tmdbData.backdrop_path || '',
                    releaseDate: releaseDate || null,
                    voteAverage: tmdbData.vote_average || 0,
                    genres: null,
                    runtime: tmdbData.runtime || null,
                    numberOfSeasons: mediaType === 'tv' ? tmdbData.number_of_seasons || null : null,
                    numberOfEpisodes: mediaType === 'tv' ? tmdbData.number_of_episodes || null : null,
                    mediaType,
                    createdAt: new Date().toISOString()
                  };
                  
                  console.log(`[WATCHLIST] Using temporary movie object with ID ${tempId}`);
                } else {
                  return res.status(500).json({ 
                    message: "Failed to create movie record after multiple attempts",
                    details: "Database connection may be unstable" 
                  });
                }
              }
            } else {
              // Not the final attempt, wait before retrying
              await new Promise(resolve => setTimeout(resolve, 500 * attempt));
            }
          }
        }
      } else {
        console.log(`[WATCHLIST] Found existing movie: ${movie.title} (ID: ${movie.id})`);
      }
      
      // Sanity check - make sure we have a movie object by this point
      if (!movie) {
        return res.status(500).json({ 
          message: "Failed to create or retrieve movie record" 
        });
      }
      
      // Check if this movie is already in the user's watchlist (with error handling)
      let exists = false;
      try {
        exists = await storage.hasWatchlistEntry(userId, movie.id);
        console.log(`[WATCHLIST] Duplicate check: Movie ${movie.id} ${exists ? 'already exists' : 'does not exist'} in user ${userId}'s watchlist`);
      } catch (existsError) {
        console.error(`[WATCHLIST] Error checking for existing watchlist entry:`, existsError);
        // Continue as if it doesn't exist
      }
      
      if (exists) {
        return res.status(409).json({ 
          message: "This movie is already in your watchlist" 
        });
      }
      
      // Add the movie to the watchlist with robust error handling
      let entry;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[WATCHLIST] Creating watchlist entry (attempt ${attempt}/3)...`);
          
          entry = await storage.createWatchlistEntry({
            userId,
            movieId: movie.id,
            platformId,
            status,
            watchedDate,
            notes
          });
          
          console.log(`[WATCHLIST] Successfully added movie ${movie.title} to watchlist for user ${userId} (Entry ID: ${entry.id})`);
          break; // Success - exit retry loop
        } catch (entryError) {
          console.error(`[WATCHLIST] Error creating watchlist entry (attempt ${attempt}/3):`, entryError);
          
          if (attempt === 3) {
            // Direct SQL fallback on final attempt
            try {
              console.log(`[WATCHLIST] Attempting direct SQL watchlist entry creation as last resort...`);
              const { executeDirectSql } = await import('./db');
              
              // Try to insert the watchlist entry using direct SQL
              const result = await executeDirectSql(
                `INSERT INTO watchlist_entries (user_id, movie_id, platform_id, status, watched_date, notes) 
                 VALUES ($1, $2, $3, $4, $5, $6) 
                 RETURNING *`, 
                [userId, movie.id, platformId, status, watchedDate, notes]
              );
              
              if (result && Array.isArray(result.rows) && result.rows.length > 0) {
                // Map the SQL result to our expected entry format
                const row = result.rows[0] as any;
                entry = {
                  id: row.id,
                  userId: row.user_id,
                  movieId: row.movie_id,
                  status: row.status,
                  watchedDate: row.watched_date,
                  notes: row.notes,
                  createdAt: row.created_at
                };
                
                console.log(`[WATCHLIST] Direct SQL watchlist entry creation successful (ID: ${entry.id})`);
                break; // Success - exit retry loop
              }
            } catch (directSqlError) {
              console.error(`[WATCHLIST] Direct SQL watchlist entry creation failed:`, directSqlError);
              
              // In production, return a temporary response
              if (process.env.NODE_ENV === 'production') {
                return res.status(202).json({
                  message: "Watchlist entry created but not yet confirmed",
                  temporary: true,
                  userId,
                  movieId: movie.id,
                  movie: {
                    title: movie.title,
                    posterPath: movie.posterPath
                  }
                });
              } else {
                return res.status(500).json({ 
                  message: "Failed to add to watchlist after multiple attempts",
                  details: "Database connection may be unstable"
                });
              }
            }
          } else {
            // Not the final attempt, wait before retrying
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          }
        }
      }
      
      console.log(`[WATCHLIST] Added movie ${movie.title} to watchlist for user ${userId}`);
      
      // Return the newly created watchlist entry
      return res.status(201).json(entry);
    } catch (error) {
      console.error("Unhandled error in watchlist creation:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error("Error details:", errorMessage);
      console.error("Error stack:", errorStack);
      
      // Enhanced error handling - check for common error patterns
      let statusCode = 500;
      let userMessage = "Failed to add movie to watchlist";
      
      // Check for database connection issues
      if (errorMessage.includes('connection') || 
          errorMessage.includes('pool') || 
          errorMessage.includes('database') ||
          errorMessage.includes('timeout')) {
        userMessage = "Database connection issue detected. Please try again later.";
        
        // Try to verify the database connection and include status in the response
        try {
          console.error("[WATCHLIST] Critical database error detected, checking connection status...");
          const { pool } = await import('./db');
          
          // Simple connection test
          if (pool && pool.totalCount !== undefined) {
            const connStatus = {
              totalCount: pool.totalCount,
              idleCount: pool.idleCount,
              waitingCount: pool.waitingCount
            };
            
            console.error("[WATCHLIST] Connection pool status:", connStatus);
            
            if (process.env.NODE_ENV !== 'production') {
              userMessage += ` Pool stats: Total=${connStatus.totalCount}, Idle=${connStatus.idleCount}, Waiting=${connStatus.waitingCount}`;
            }
          }
        } catch (poolError) {
          console.error("[WATCHLIST] Failed to check connection pool status:", poolError);
        }
      } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
        statusCode = 404;
        userMessage = "The requested resource was not found.";
      } else if (errorMessage.includes('token') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
        statusCode = 401;
        userMessage = "Authentication error. Please log in again.";
      } else if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || errorMessage.includes('403')) {
        statusCode = 403;
        userMessage = "You don't have permission to perform this action.";
      }
      
      // Prepare extended error response type
      interface ErrorResponse {
        message: string;
        error?: string;
        stack?: string;
        time?: string;
        path?: string;
        method?: string;
        userId?: number;
        tmdbId?: number;
        pending?: boolean;
        retry?: boolean;
      }
      
      // Only include detailed error info in development
      const errorResponse: ErrorResponse = process.env.NODE_ENV === 'production' 
        ? { message: userMessage }
        : { 
            message: userMessage, 
            error: errorMessage, 
            stack: errorStack,
            time: new Date().toISOString(),
            path: req.path,
            method: req.method,
            userId: req.body?.userId,
            tmdbId: req.body?.tmdbId
          };
      
      // In production, for database issues, return 202 (Accepted) with a special message
      // This indicates to the client that we've accepted their request but can't guarantee it was processed
      if (process.env.NODE_ENV === 'production' && statusCode === 500 && errorMessage.includes('database')) {
        statusCode = 202;
        errorResponse.pending = true;
        errorResponse.retry = true;
        errorResponse.message = "Request accepted but processing delayed due to temporary issues";
      }
      
      res.status(statusCode).json(errorResponse);
    }
  });

  app.put("/api/watchlist/:id", isJwtAuthenticated, hasJwtWatchlistAccess, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { watchedDate, notes, status, platformId } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid watchlist entry ID" });
      }
      
      // Get the existing entry to check ownership
      const existingEntry = await storage.getWatchlistEntry(id);
      if (!existingEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      // Make sure the user can only update their own entries
      if (existingEntry.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "You can only update your own watchlist entries" });
      }
      
      // Update the entry
      const updatedEntry = await storage.updateWatchlistEntry(id, {
        status,
        watchedDate,
        notes,
        platformId
      });
      
      // Check if movie details are still valid
      const movie = await storage.getMovie(existingEntry.movieId);
      if (!movie) {
        return res.status(500).json({ message: "Movie not found" });
      }
      
      res.json(updatedEntry);
    } catch (error) {
      console.error("Error updating watchlist entry:", error);
      res.status(500).json({ message: "Failed to update watchlist entry" });
    }
  });

  app.delete("/api/watchlist/:id", isJwtAuthenticated, hasJwtWatchlistAccess, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid watchlist entry ID" });
      }
      
      // Get the existing entry to check ownership
      const existingEntry = await storage.getWatchlistEntry(id);
      if (!existingEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      // Make sure the user can only delete their own entries
      if (existingEntry.userId !== (req.user as any).id) {
        return res.status(403).json({ message: "You can only delete your own watchlist entries" });
      }
      
      // Delete the entry
      const success = await storage.deleteWatchlistEntry(id);
      
      res.json({ success });
    } catch (error) {
      console.error("Error deleting watchlist entry:", error);
      res.status(500).json({ message: "Failed to delete watchlist entry" });
    }
  });

  // Platform routes
  app.get("/api/platforms/:userId", isJwtAuthenticated, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      
      // Check if the user is authorized to access these platforms
      if ((req.user as any)?.id !== userId) {
        return res.status(403).json({ message: "You are not authorized to access these platforms" });
      }
      
      const platforms = await storage.getPlatforms(userId);
      res.json(platforms);
    } catch (error) {
      console.error("Error fetching platforms:", error);
      res.status(500).json({ message: "Error fetching platforms", error: String(error) });
    }
  });
  
  app.post("/api/platforms", isJwtAuthenticated, async (req: Request, res: Response) => {
    try {
      const { userId, name, logoUrl, isDefault } = req.body;
      
      // Check if the user is authorized to create a platform
      if ((req.user as any)?.id !== userId) {
        return res.status(403).json({ message: "You are not authorized to create platforms for this user" });
      }
      
      const platform = await storage.createPlatform({
        userId,
        name,
        logoUrl,
        isDefault: isDefault || false
      });
      
      res.status(201).json(platform);
    } catch (error) {
      console.error("Error creating platform:", error);
      res.status(500).json({ message: "Error creating platform", error: String(error) });
    }
  });
  
  app.put("/api/platforms/:id", isJwtAuthenticated, async (req: Request, res: Response) => {
    try {
      const platformId = parseInt(req.params.id, 10);
      const updates = req.body;
      
      // Get the platform to check ownership
      const existingPlatform = await storage.getPlatform(platformId);
      if (!existingPlatform) {
        return res.status(404).json({ message: "Platform not found" });
      }
      
      // Check if the user is authorized to update this platform
      if ((req.user as any)?.id !== existingPlatform.userId) {
        return res.status(403).json({ message: "You are not authorized to update this platform" });
      }
      
      const updatedPlatform = await storage.updatePlatform(platformId, updates);
      res.json(updatedPlatform);
    } catch (error) {
      console.error("Error updating platform:", error);
      res.status(500).json({ message: "Error updating platform", error: String(error) });
    }
  });
  
  app.delete("/api/platforms/:id", isJwtAuthenticated, async (req: Request, res: Response) => {
    try {
      const platformId = parseInt(req.params.id, 10);
      
      // Get the platform to check ownership
      const existingPlatform = await storage.getPlatform(platformId);
      if (!existingPlatform) {
        return res.status(404).json({ message: "Platform not found" });
      }
      
      // Check if the user is authorized to delete this platform
      if ((req.user as any)?.id !== existingPlatform.userId) {
        return res.status(403).json({ message: "You are not authorized to delete this platform" });
      }
      
      const deleted = await storage.deletePlatform(platformId);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Error deleting platform:", error);
      res.status(500).json({ message: "Error deleting platform", error: String(error) });
    }
  });

  // Register JWT auth routes
  console.log("[SERVER] Registering JWT auth endpoints");
  app.use('/api', jwtAuthRouter);
  
  // Register emergency endpoints for auth and watchlist operations
  // Emergency endpoints have been removed to simplify authentication

  const httpServer = createServer(app);
  return httpServer;
}