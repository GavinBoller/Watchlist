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
    try {
      const { userId, tmdbMovie, watchedDate, notes } = req.body;
      
      if (!userId || !tmdbMovie) {
        return res.status(400).json({ message: "User ID and movie data are required" });
      }
      
      // Check if user exists
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if movie already exists in our database, if not create it
      let movie = await storage.getMovieByTmdbId(tmdbMovie.id);
      
      if (!movie) {
        // Convert genre IDs to genre names
        const genreNames = await convertGenreIdsToNames(tmdbMovie.genre_ids, tmdbMovie.media_type || "movie");
        const genres = genreNames.join(",");
        
        const mediaType = tmdbMovie.media_type || "movie";
        const title = tmdbMovie.title || tmdbMovie.name || "Unknown Title";
        const releaseDate = tmdbMovie.release_date || tmdbMovie.first_air_date || null;
        
        const movieData = insertMovieSchema.parse({
          tmdbId: tmdbMovie.id,
          title,
          overview: tmdbMovie.overview,
          posterPath: tmdbMovie.poster_path,
          backdropPath: tmdbMovie.backdrop_path,
          releaseDate,
          voteAverage: tmdbMovie.vote_average.toString(),
          genres,
          mediaType,
        });
        
        movie = await storage.createMovie(movieData);
      }
      
      // Check if this movie is already in the user's watchlist
      const alreadyInWatchlist = await storage.hasWatchlistEntry(userId, movie.id);
      if (alreadyInWatchlist) {
        return res.status(409).json({ 
          message: "Movie already in watchlist", 
          details: "This movie is already in your watched list" 
        });
      }
      
      // Create watchlist entry
      const entryData = insertWatchlistEntrySchema.parse({
        userId,
        movieId: movie.id,
        watchedDate: watchedDate ? watchedDate : null, // Keep as string for SQLite
        notes: notes || null,
      });
      
      const watchlistEntry = await storage.createWatchlistEntry(entryData);
      
      // Return the entry with movie details
      const entryWithMovie = {
        ...watchlistEntry,
        movie,
      };
      
      res.status(201).json(entryWithMovie);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ message: "Invalid watchlist entry data", errors: error.errors });
      } else {
        console.error("Error creating watchlist entry:", error);
        res.status(500).json({ message: "Failed to add movie to watchlist" });
      }
    }
  });

  app.put("/api/watchlist/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { watchedDate, notes } = req.body;
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid watchlist entry ID" });
      }
      
      const existingEntry = await storage.getWatchlistEntry(id);
      if (!existingEntry) {
        return res.status(404).json({ message: "Watchlist entry not found" });
      }
      
      const updates = {
        ...(watchedDate !== undefined && { watchedDate }), // Keep as string for SQLite
        ...(notes !== undefined && { notes }),
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
