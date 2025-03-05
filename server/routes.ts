import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import { z } from "zod";
import { 
  insertUserSchema, 
  insertMovieSchema, 
  insertWatchlistEntrySchema,
  type TMDBSearchResponse,
  type TMDBMovie
} from "@shared/schema";

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

  // Watchlist routes
  app.get("/api/watchlist/:userId", async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.userId, 10);
      
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const watchlist = await storage.getWatchlistEntries(userId);
      res.json(watchlist);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch watchlist" });
    }
  });

  app.post("/api/watchlist", async (req: Request, res: Response) => {
    console.log("POST /api/watchlist - Request body:", JSON.stringify(req.body, null, 2));
    console.log("Environment:", process.env.NODE_ENV || 'development');
    
    // Log authentication status - this helps debug 401 issues
    console.log("User authenticated:", req.isAuthenticated());
    if (req.isAuthenticated()) {
      console.log("Authenticated user:", (req.user as any)?.id, (req.user as any)?.username);
    } else {
      console.warn("WARNING: User not authenticated when accessing watchlist POST endpoint");
      // We should not reach here because of the middleware, but just in case:
      return res.status(401).json({ message: "You must be logged in to add items to your watchlist" });
    }
    
    try {
      const { userId, tmdbMovie, watchedDate, notes, status } = req.body;
      
      // Enhanced validation for production stability
      if (!userId) {
        console.log("Missing userId field");
        return res.status(400).json({ message: "User ID is required" });
      }
      
      if (!tmdbMovie) {
        console.log("Missing tmdbMovie field");
        return res.status(400).json({ message: "Movie data is required" });
      }
      
      if (!tmdbMovie.id) {
        console.log("Missing tmdbMovie.id field");
        return res.status(400).json({ message: "Movie ID is required" });
      }
      
      // Check for authentication if in production - prevent malicious access
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd && req.isAuthenticated()) {
        const authenticatedUserId = (req.user as any)?.id;
        if (authenticatedUserId && authenticatedUserId !== userId) {
          console.log("Auth mismatch - auth user:", authenticatedUserId, "request user:", userId);
          return res.status(403).json({ message: "You can only add movies to your own watchlist" });
        }
      }
      
      // Check if user exists - with enhanced error handling and type checking
      console.log("Checking if user exists - userId:", userId, "typeof:", typeof userId);
      
      // Try to parse userId to number if it's a string
      let userIdNum = userId;
      if (typeof userId === 'string') {
        userIdNum = parseInt(userId, 10);
        console.log("Converted userId string to number:", userIdNum);
      }
      
      const user = await storage.getUser(userIdNum);
      
      // Enhanced user checking with fallback if user not found
      if (!user) {
        console.log("User not found - userId:", userIdNum);
        
        // If we have an authenticated user but their ID doesn't match the requested ID
        if (req.isAuthenticated() && req.user) {
          const authUserId = (req.user as any).id;
          console.log("Using authenticated user instead - authUserId:", authUserId);
          const authUser = await storage.getUser(authUserId);
          
          if (authUser) {
            console.log("Found authenticated user:", authUser.username);
            // Proceed with the authenticated user instead
            userIdNum = authUserId;
          } else {
            // Try to get users to help with debugging
            const allUsers = await storage.getAllUsers();
            console.log("Available users:", allUsers.map(u => ({ id: u.id, username: u.username })));
            
            return res.status(404).json({ 
              message: "User not found", 
              details: "No valid user found for this request"
            });
          }
        } else {
          // Try to get users to help with debugging
          const allUsers = await storage.getAllUsers();
          console.log("Available users:", allUsers.map(u => ({ id: u.id, username: u.username })));
          
          return res.status(404).json({ 
            message: "User not found", 
            details: "The user ID provided doesn't exist in the database"
          });
        }
      } else {
        console.log("User found:", user.username, "ID:", user.id);
      }
      
      // Ensure tmdbMovie has the required fields with fallback values for production robustness
      const validatedTmdbMovie = {
        id: tmdbMovie.id || 0,
        title: tmdbMovie.title || tmdbMovie.name || "Unknown Title",
        overview: tmdbMovie.overview || "",
        poster_path: tmdbMovie.poster_path || null,
        backdrop_path: tmdbMovie.backdrop_path || null,
        release_date: tmdbMovie.release_date || tmdbMovie.first_air_date || null,
        vote_average: tmdbMovie.vote_average || 0,
        genre_ids: Array.isArray(tmdbMovie.genre_ids) ? tmdbMovie.genre_ids : [],
        media_type: tmdbMovie.media_type || "movie"
      };
      
      if (validatedTmdbMovie.id === 0) {
        console.error("Invalid TMDB movie data - missing ID");
        return res.status(400).json({ message: "Invalid movie data: missing ID" });
      }
      
      // Check if movie already exists in our database, if not create it
      console.log("Checking if movie exists in database - tmdbId:", validatedTmdbMovie.id);
      let movie = await storage.getMovieByTmdbId(validatedTmdbMovie.id);
      
      if (!movie) {
        console.log("Movie not found in database, creating new record");
        // Convert genre IDs to genre names
        const genreNames = await convertGenreIdsToNames(validatedTmdbMovie.genre_ids, validatedTmdbMovie.media_type);
        const genres = genreNames.join(",");
        
        const mediaType = validatedTmdbMovie.media_type || "movie";
        const title = validatedTmdbMovie.title || "Unknown Title";
        const releaseDate = validatedTmdbMovie.release_date || null;
        
        try {
          const movieData = {
            tmdbId: validatedTmdbMovie.id,
            title,
            overview: validatedTmdbMovie.overview || "",
            posterPath: validatedTmdbMovie.poster_path || null,
            backdropPath: validatedTmdbMovie.backdrop_path || null,
            releaseDate,
            voteAverage: validatedTmdbMovie.vote_average?.toString() || "0",
            genres,
            mediaType,
          };
          
          console.log("Creating movie with data:", JSON.stringify(movieData, null, 2));
          
          // Validate the movie data
          const validatedMovieData = insertMovieSchema.parse(movieData);
          movie = await storage.createMovie(validatedMovieData);
          console.log("Movie created successfully:", movie.id);
          
        } catch (movieError) {
          console.error("Error creating movie record:", movieError);
          
          // Check if the movie was created despite the error (race condition)
          const existingMovie = await storage.getMovieByTmdbId(validatedTmdbMovie.id);
          if (existingMovie) {
            console.log("Movie found after error (possible race condition):", existingMovie.id);
            movie = existingMovie;
          } else {
            throw new Error(`Failed to create movie record: ${movieError instanceof Error ? movieError.message : 'Unknown error'}`);
          }
        }
      } else {
        console.log("Movie found in database:", movie.id, movie.title);
      }
      
      // Check if this movie is already in the user's watchlist
      console.log("Checking if movie is already in user's watchlist - userId:", userIdNum, "movieId:", movie.id);
      const alreadyInWatchlist = await storage.hasWatchlistEntry(userIdNum, movie.id);
      if (alreadyInWatchlist) {
        const movieTitle = movie.title || "this title";
        console.log("Movie already in watchlist:", movieTitle);
        
        // Find the existing entry to return to client
        const entries = await storage.getWatchlistEntries(userIdNum);
        const existingEntry = entries.find(entry => entry.movieId === movie.id);
        
        if (existingEntry) {
          console.log("Returning existing watchlist entry:", existingEntry.id);
          return res.status(200).json({
            ...existingEntry,
            message: "Already in watchlist",
            details: `You've already added "${movieTitle}" to your watchlist`
          });
        }
        
        return res.status(409).json({ 
          message: "Already in watchlist", 
          details: `You've already added "${movieTitle}" to your watchlist` 
        });
      }
      
      // Validate the status
      const validStatus = status === 'to_watch' || status === 'watching' || status === 'watched' 
        ? status 
        : 'to_watch'; // Default to 'to_watch' if not specified or invalid
      
      console.log("Creating watchlist entry with status:", validStatus);
      
      try {
        // Create watchlist entry - ensure we use the validated userIdNum
        const entryData = {
          userId: userIdNum,
          movieId: movie.id,
          watchedDate: watchedDate || null,
          notes: notes || null,
          status: validStatus,
        };
        
        console.log("Watchlist entry data:", JSON.stringify(entryData, null, 2));
        // Validate and create the entry
        const validatedEntryData = insertWatchlistEntrySchema.parse(entryData);
        const watchlistEntry = await storage.createWatchlistEntry(validatedEntryData);
        console.log("Watchlist entry created successfully:", watchlistEntry.id);
        
        // Return the entry with movie details
        const entryWithMovie = {
          ...watchlistEntry,
          movie,
        };
        
        res.status(201).json(entryWithMovie);
        console.log("Watchlist entry response sent with status 201");
      } catch (entryError) {
        // Try to gracefully handle the error
        console.error("Error creating watchlist entry:", entryError);
        
        if (entryError instanceof z.ZodError) {
          console.error("Validation error details:", JSON.stringify(entryError.errors, null, 2));
          return res.status(400).json({ 
            message: "Invalid watchlist entry data", 
            errors: entryError.errors 
          });
        }
        
        // Check for duplicate entry (race condition)
        const errorMessage = entryError instanceof Error ? entryError.message : 'Unknown error';
        if (errorMessage.includes('duplicate') || errorMessage.includes('unique constraint')) {
          console.log("Detected duplicate entry error, retrieving existing entry");
          
          // Try to find the existing entry - use the validated userIdNum
          const entries = await storage.getWatchlistEntries(userIdNum);
          const existingEntry = entries.find(entry => entry.movieId === movie.id);
          
          if (existingEntry) {
            console.log("Found existing entry after error:", existingEntry.id);
            return res.status(200).json({
              ...existingEntry,
              message: "Entry already exists",
              details: "This movie is already in your watchlist"
            });
          }
        }
        
        // Pass the error details to client for debugging in development
        const isDevEnvironment = process.env.NODE_ENV !== 'production';
        const errorDetails = isDevEnvironment ? {
          error: errorMessage,
          stack: entryError instanceof Error ? entryError.stack : undefined
        } : {};
        
        res.status(500).json({ 
          message: "Failed to add movie to watchlist", 
          ...errorDetails
        });
      }
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

  app.put("/api/watchlist/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { watchedDate, notes, status } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid watchlist entry ID" });
      }
      
      const existingEntry = await storage.getWatchlistEntry(id);
      if (!existingEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      // Validate the status if provided
      let validStatus = undefined;
      if (status !== undefined) {
        validStatus = status === 'to_watch' || status === 'watching' || status === 'watched' 
          ? status 
          : 'watched'; // Default to 'watched' if invalid value
      }
      
      const updates = {
        ...(watchedDate !== undefined && { watchedDate }), // Keep as string for SQLite
        ...(notes !== undefined && { notes }),
        ...(validStatus !== undefined && { status: validStatus }),
      };
      
      const updatedEntry = await storage.updateWatchlistEntry(id, updates);
      
      if (!updatedEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      // Get the movie details to return the complete entry
      const movie = await storage.getMovie(updatedEntry.movieId);
      if (!movie) {
        return res.status(500).json({ message: "Movie not found" });
      }
      
      const entryWithMovie = {
        ...updatedEntry,
        movie,
      };
      
      res.json(entryWithMovie);
    } catch (error) {
      res.status(500).json({ message: "Failed to update watchlist entry" });
    }
  });

  app.delete("/api/watchlist/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid watchlist entry ID" });
      }
      
      const existingEntry = await storage.getWatchlistEntry(id);
      if (!existingEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      const deleted = await storage.deleteWatchlistEntry(id);
      
      if (!deleted) {
        return res.status(500).json({ message: "Failed to delete watchlist entry" });
      }
      
      res.status(204).end();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete watchlist entry" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
