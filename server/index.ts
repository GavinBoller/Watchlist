import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { config } from "dotenv";
import session from "express-session";
import passport from "passport";
import { configurePassport } from "./auth";
import authRoutes from "./authRoutes";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { pool } from "./db";

// Load environment variables from .env file
config();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure session storage based on environment
// Enable longer timeout for session operations
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'watchlist-app-secret';

// Setup session store with fallback
let sessionStore;
let usePostgresSession = false;

// Use PostgreSQL session store in production when database is available
if (isProd && process.env.DATABASE_URL) {
  try {
    // Initialize Postgres session store with the pool from db.ts
    const PgSessionStore = connectPgSimple(session);
    sessionStore = new PgSessionStore({
      pool,
      tableName: 'session', // Default session table name
      createTableIfMissing: true,
      // Add reconnect and error handling
      errorLog: (err) => console.error('Session store error:', err),
      pruneSessionInterval: 60 * 15 // Prune expired sessions every 15 min
    });
    
    // Indicate we're using postgres for session storage
    usePostgresSession = true;
    console.log('Using PostgreSQL session store for persistence');
  } catch (err) {
    console.error('Failed to initialize PostgreSQL session store, falling back to memory store:', err);
    
    // Fall back to memory store in case of errors
    const MemoryStoreSession = MemoryStore(session);
    sessionStore = new MemoryStoreSession({
      checkPeriod: 86400000 // prune expired entries every 24h
    });
  }
} else {
  // Use memory store for development
  const MemoryStoreSession = MemoryStore(session);
  sessionStore = new MemoryStoreSession({
    checkPeriod: 86400000 // prune expired entries every 24h
  });
  
  console.log('Using memory session store');
}

// Configure session middleware with appropriate settings
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  proxy: isProd, // Trust the reverse proxy in production
  rolling: true, // Reset expiration countdown on every response
  cookie: {
    // Only use secure cookies in production with HTTPS
    secure: isProd && process.env.ENFORCE_SECURE_COOKIES === 'true',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax', // This helps with CSRF protection and improves cookie security
    // Fallback to 'strict' in production if not using a custom domain
    path: '/'
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Register auth routes
app.use('/api/auth', authRoutes);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    
    // Log all server errors
    console.error('Server error:', err);
    
    // Send detailed error information in development
    if (app.get('env') === 'development') {
      res.status(status).json({
        message,
        error: err.toString(),
        stack: err.stack
      });
    } else {
      // Send limited information in production
      res.status(status).json({ message });
    }
    
    // Don't throw the error after handling it - this could crash the server
    // if there's no further error handler
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
