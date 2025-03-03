import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import axios from "axios";
import { z } from "zod";
import { 
  insertUserSchema, 
  insertMovieSchema, 
  insertWatchlistEntrySchema,
  type TMDBSearchResponse
} from "@shared/schema";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "79d177894334dec45f251ff671833a50";
const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

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

  // Movie search route (TMDB API)
  app.get("/api/movies/search", async (req: Request, res: Response) => {
    try {
      const { query } = req.query;
      
      if (!query || typeof query !== "string") {
        return res.status(400).json({ message: "Query parameter is required" });
      }
      
      const response = await axios.get<TMDBSearchResponse>(`${TMDB_API_BASE_URL}/search/movie`, {
        params: {
          api_key: TMDB_API_KEY,
          query,
          include_adult: false,
        },
      });
      
      res.json(response.data);
    } catch (error) {
      res.status(500).json({ message: "Failed to search movies" });
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
        const genres = tmdbMovie.genre_ids?.join(",") || "";
        
        const movieData = insertMovieSchema.parse({
          tmdbId: tmdbMovie.id,
          title: tmdbMovie.title,
          overview: tmdbMovie.overview,
          posterPath: tmdbMovie.poster_path,
          backdropPath: tmdbMovie.backdrop_path,
          releaseDate: tmdbMovie.release_date,
          voteAverage: tmdbMovie.vote_average.toString(),
          genres,
        });
        
        movie = await storage.createMovie(movieData);
      }
      
      // Create watchlist entry
      const entryData = insertWatchlistEntrySchema.parse({
        userId,
        movieId: movie.id,
        watchedDate: watchedDate ? new Date(watchedDate) : null,
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
        ...(watchedDate !== undefined && { watchedDate: new Date(watchedDate) }),
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
