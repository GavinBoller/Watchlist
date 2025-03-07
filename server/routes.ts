import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { isAuthenticated, hasWatchlistAccess, validateSession } from "./auth";
import { isJwtAuthenticated, hasJwtWatchlistAccess } from "./jwtMiddleware";
import { extractTokenFromHeader, verifyToken } from "./jwtAuth";
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
import { emergencyAuthRouter, emergencyAuthCheck } from "./emergencyAuth";
import { emergencyWatchlistRouter } from "./emergencyWatchlist";
import { jwtAuthRouter } from "./jwtAuthRoutes";
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
  
  // Register emergency routes for reliable authentication and watchlist operations
  // These routes will work even when standard routes fail
  console.log("[SERVER] Registering emergency auth endpoints");
  app.use("/api", emergencyAuthRouter);
  app.use("/api/emergency", emergencyWatchlistRouter);
  
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
    
    try {
      const userId = parseInt(req.params.userId, 10);
      console.log(`[WATCHLIST] Fetching watchlist for user ID: ${userId}`);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      // For safer watchlist access across environments
      let watchlistData: WatchlistEntryWithMovie[] = [];
      let userFound = false;
      
      // STEP 1: Try standard approach first
      try {
        // Get user to verify existence
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
          
          return res.json(watchlistData);
        } else {
          console.log(`[WATCHLIST] User with ID ${userId} not found in standard lookup`);
        }
      } catch (primaryError) {
        console.error(`[WATCHLIST] Error in primary watchlist fetch:`, primaryError);
      }
      
      // If we reach here, something went wrong with the primary fetch
      return res.status(404).json({ message: "Watchlist not found" });
    } catch (error) {
      console.error("Error fetching watchlist:", error);
      res.status(500).json({ message: "Failed to fetch watchlist" });
    }
  });

  // POST endpoint to add movie to watchlist with enhanced JWT verification
  app.post("/api/watchlist", async (req: Request, res: Response) => {
    console.log("POST /api/watchlist - Request body:", JSON.stringify(req.body, null, 2));
    console.log("POST /api/watchlist - Headers:", JSON.stringify({
      auth: req.headers.authorization ? "Present" : "Missing",
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent']
    }, null, 2));
    
    try {
      // First, check if the user is already authenticated via session
      if (req.isAuthenticated() && req.user) {
        console.log(`[WATCHLIST] User already authenticated via session: ${(req.user as any).username}`);
      } else {
        console.log('[WATCHLIST] No session authentication, checking for JWT token');
      }
      
      // Try JWT token verification
      const token = extractTokenFromHeader(req.headers.authorization);
      let authUser: any = null;
      let tokenVerified = false;
      
      if (token) {
        console.log('[WATCHLIST] JWT token found in request');
        try {
          const userPayload = verifyToken(token);
          if (userPayload) {
            console.log(`[WATCHLIST] JWT token verified for user: ${userPayload.username}`);
            authUser = userPayload;
            req.user = userPayload; // Set user on the request object
            tokenVerified = true;
          } else {
            console.log('[WATCHLIST] JWT token verification failed');
          }
        } catch (tokenError) {
          console.error('[WATCHLIST] JWT token verification error:', tokenError);
        }
      } else {
        console.log('[WATCHLIST] No JWT token in request');
      }
      
      // Fallback: If no token or verification failed, check if user is already set in request
      if (!authUser && req.user) {
        console.log('[WATCHLIST] Using existing authenticated user from session');
        authUser = req.user;
      }
      
      // Try to extract user information from headers (emergency fallback)
      if (!authUser) {
        const userIdHeader = req.headers['x-user-id'];
        const usernameHeader = req.headers['x-username'];
        
        if (userIdHeader && usernameHeader) {
          console.log(`[WATCHLIST] Found user info in headers: ID=${userIdHeader}, Username=${usernameHeader}`);
          
          try {
            // Try to get the user from database
            const userId = parseInt(userIdHeader as string, 10);
            const user = await storage.getUser(userId);
            
            if (user && user.username === usernameHeader) {
              console.log(`[WATCHLIST] Emergency authentication successful via headers`);
              // Create a user response object without the password
              const { password, ...userWithoutPassword } = user;
              authUser = userWithoutPassword;
              req.user = userWithoutPassword;
            }
          } catch (dbError) {
            console.error('[WATCHLIST] Error retrieving user from headers info:', dbError);
          }
        }
      }
      
      // Check authentication
      if (!authUser) {
        console.log('[WATCHLIST] No authenticated user found');
        return res.status(401).json({ 
          message: "Authentication required",
          details: "Please log in again. Your session may have expired.",
          tokenPresent: !!token,
          tokenVerified: tokenVerified
        });
      }
      
      // Parse and validate the input
      const { userId, tmdbId, tmdbData, status = 'to_watch', watchedDate = null, notes = '' } = req.body;
      
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
      if (authUser.id !== userId) {
        console.log(`[WATCHLIST] Auth mismatch: authUser.id=${authUser.id}, userId=${userId}`);
        return res.status(403).json({ 
          message: "You can only add movies to your own watchlist" 
        });
      }
      
      // Check if this movie already exists in our database
      let movie = await storage.getMovieByTmdbId(tmdbId);
      
      // If not, create the movie record
      if (!movie) {
        const mediaType = tmdbData.media_type || 'movie';
        const title = mediaType === 'tv' ? tmdbData.name : tmdbData.title;
        const releaseDate = mediaType === 'tv' ? tmdbData.first_air_date : tmdbData.release_date;
        
        try {
          movie = await storage.createMovie({
            tmdbId,
            title: title || '[Unknown Title]',
            overview: tmdbData.overview || '',
            posterPath: tmdbData.poster_path || '',
            backdropPath: tmdbData.backdrop_path || '',
            releaseDate: releaseDate || null,
            voteAverage: tmdbData.vote_average || 0,
            mediaType
          });
          
          console.log(`[WATCHLIST] Created new movie: ${movie.title} (ID: ${movie.id})`);
        } catch (movieError) {
          console.error(`[WATCHLIST] Error creating movie:`, movieError);
          return res.status(500).json({ message: "Error creating movie record" });
        }
      } else {
        console.log(`[WATCHLIST] Found existing movie: ${movie.title} (ID: ${movie.id})`);
      }
      
      // Check if this movie is already in the user's watchlist
      const exists = await storage.hasWatchlistEntry(userId, movie.id);
      if (exists) {
        return res.status(409).json({ 
          message: "This movie is already in your watchlist" 
        });
      }
      
      // Add the movie to the watchlist
      const entry = await storage.createWatchlistEntry({
        userId,
        movieId: movie.id,
        status,
        watchedDate,
        notes
      });
      
      console.log(`[WATCHLIST] Added movie ${movie.title} to watchlist for user ${userId}`);
      
      // Return the newly created watchlist entry
      return res.status(201).json(entry);
    } catch (error) {
      console.error("Unhandled error in watchlist creation:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error("Error details:", errorMessage);
      console.error("Error stack:", errorStack);
      
      // Only include detailed error info in development
      const errorResponse = process.env.NODE_ENV === 'production' 
        ? { message: "Failed to add movie to watchlist" }
        : { message: "Failed to add movie to watchlist", error: errorMessage, stack: errorStack };
      
      res.status(500).json(errorResponse);
    }
  });

  app.put("/api/watchlist/:id", isJwtAuthenticated, hasJwtWatchlistAccess, async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { watchedDate, notes, status } = req.body;
      
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
        notes
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

  // Register JWT auth routes
  console.log("[SERVER] Registering JWT auth endpoints");
  app.use('/api', jwtAuthRouter);
  
  // Register emergency endpoints for auth and watchlist operations
  console.log("[SERVER] Registering emergency auth endpoints");
  app.use('/api/auth', emergencyAuthRouter);
  
  // Register emergency watchlist endpoints 
  console.log("[SERVER] Registering emergency watchlist endpoints");
  app.use('/api/emergency/watchlist', emergencyWatchlistRouter);

  const httpServer = createServer(app);
  return httpServer;
}