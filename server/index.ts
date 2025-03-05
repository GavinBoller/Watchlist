import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { config } from "dotenv";
import session from "express-session";
import passport from "passport";
import { configurePassport, isAuthenticated, hasWatchlistAccess } from "./auth";
import authRoutes from "./authRoutes";
import MemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { pool, db } from "./db";
import { exec } from "child_process";
import util from "util";
import fs from "fs";

// Load environment variables from .env file
config();

// Create Promise-based exec
const execPromise = util.promisify(exec);

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure session storage based on environment
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'watchlist-app-secret';

// Setup session store with fallback
let sessionStore: any; // Using any type here since we'll be assigning different types of stores
let usePostgresSession = false;

// Create session table if needed
async function createSessionTable(dbPool: any) {
  if (!dbPool) {
    console.error("Cannot create session table: database pool is undefined");
    return false;
  }
  
  try {
    // Execute direct SQL to create the session table if it doesn't exist
    // This matches the exact structure from connect-pg-simple
    await dbPool.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      )
    `);
    console.log("Session table created or verified successfully");
    return true;
  } catch (tableErr) {
    console.error("Error creating session table:", tableErr);
    return false;
  }
}

// Configure session store based on database availability
async function setupSessionStore() {
  // Environment-specific configuration
  const isProd = process.env.NODE_ENV === 'production';
  console.log(`Setting up session store for ${isProd ? 'production' : 'development'} environment`);
  
  // Use PostgreSQL session store whenever DATABASE_URL is available
  if (process.env.DATABASE_URL) {
    try {
      // First, make sure the session table exists
      const tableCreated = await createSessionTable(pool);
      
      if (tableCreated) {
        // Initialize Postgres session store with the pool from db.ts
        const PgSessionStore = connectPgSimple(session);
        
        // Now create the session store with environment-specific settings
        sessionStore = new PgSessionStore({
          pool,
          tableName: 'session',
          // Table already created above, so we don't need this flag
          createTableIfMissing: false, 
          // Add enhanced error handling for production
          errorLog: (err) => {
            console.error('Session store error:', err);
            // Additional logging for production errors
            if (isProd) {
              console.error('Production session error details:', {
                time: new Date().toISOString(),
                name: err.name,
                code: err.code,
                stack: err.stack?.substring(0, 200) // Truncate for readability
              });
            }
          },
          // More frequent pruning in production for better performance
          pruneSessionInterval: isProd ? 60 * 30 : 60 * 15, // 30 or 15 minutes
          // Custom retry logic for production
          retryStrategy: isProd ? {
            retries: 5,              // Try harder in production
            factor: 2,               // Exponential backoff
            minTimeout: 1000,        // Start at 1 second
            maxTimeout: 30000,       // Max 30 seconds between retries
            randomize: true          // Add jitter to prevent thundering herd
          } : undefined
        });
        
        // Test connection if in production to validate store
        if (isProd) {
          try {
            const testSessionId = `test-${Date.now()}`;
            await new Promise<void>((resolve, reject) => {
              sessionStore.set(testSessionId, { test: true }, (err) => {
                if (err) reject(err);
                else {
                  // Clean up test session immediately
                  sessionStore.destroy(testSessionId, () => resolve());
                }
              });
            });
            console.log('PostgreSQL session store connection validated successfully');
          } catch (testError) {
            console.error('Session store validation failed:', testError);
            // Continue anyway - we'll fall back below if needed
          }
        }
        
        // Indicate we're using postgres for session storage
        usePostgresSession = true;
        console.log('Using PostgreSQL session store for session persistence');
        return sessionStore;
      }
    } catch (err) {
      console.error('Failed to initialize PostgreSQL session store:', err);
    }
    
    // Fall back to memory store if anything failed above
    console.log('Falling back to memory store due to Postgres issues');
  }
  
  // If we reach here, use memory store as fallback
  const MemoryStoreSession = MemoryStore(session);
  sessionStore = new MemoryStoreSession({
    checkPeriod: 86400000, // prune expired entries every 24h
    // Additional memory store options for better reliability
    stale: true,           // Return stale values if issue with cache
    max: isProd ? 5000 : 1000, // More sessions in production (but limit to prevent memory issues)
    ttl: 24 * 60 * 60 * 1000,  // 24 hour TTL for all sessions
    dispose: (key) => {
      // Log when sessions are removed (in dev only to avoid log spam)
      if (!isProd) {
        console.log(`Session disposed: ${key.substring(0, 6)}... (truncated)`);
      }
    }
  });
  
  // Explicitly warn in production about memory store
  if (isProd) {
    console.warn('⚠️ WARNING: Using memory session store in production!');
    console.warn('⚠️ Sessions will be lost on service restart or deployment');
  } else if (process.env.DATABASE_URL) {
    console.log('Using memory session store (fallback due to error)');
  } else {
    console.log('Using memory session store (no DATABASE_URL provided)');
  }
  
  return sessionStore;
}

// Auth routes will be registered after passport and session setup

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

// Function to push database schema changes
async function pushDatabaseSchema() {
  if (!process.env.DATABASE_URL) {
    console.log('Skipping database schema push: No DATABASE_URL provided');
    return;
  }
  
  try {
    console.log('Attempting to push database schema changes...');
    
    // Check if drizzle.config.ts exists
    const configPath = path.resolve(process.cwd(), 'drizzle.config.ts');
    console.log(`Looking for drizzle config at: ${configPath}`);
    
    if (!fs.existsSync(configPath)) {
      console.log('drizzle.config.ts not found, skipping schema push');
      return false;
    }
    
    // Verify theme.json exists before proceeding (to prevent Vite errors)
    const themePath = path.resolve(process.cwd(), 'theme.json');
    if (!fs.existsSync(themePath)) {
      console.log('theme.json not found, creating minimal version');
      fs.writeFileSync(themePath, JSON.stringify({
        variant: "professional",
        primary: "hsl(358, 92%, 49%)",
        appearance: "dark",
        radius: 0.5
      }, null, 2));
    }
    
    const execPromise = util.promisify(exec);
    
    // Use the drizzle-kit CLI to push schema changes, with a timeout to prevent hanging
    const { stdout, stderr } = await execPromise('npx drizzle-kit push', { timeout: 10000 });
    console.log('Schema push output:', stdout);
    if (stderr) console.error('Schema push stderr:', stderr);
    console.log('Successfully pushed database schema changes!');
    return true;
  } catch (error) {
    console.error('Error pushing database schema:', error);
    console.log('Continuing application startup despite schema push failure.');
    // Add detailed error logging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    return false;
  }
}

// Main initialization function
async function startServer() {
  try {
    // We need to ensure the db connection is ready before we try to use it
    console.log("Waiting for database connection to be ready...");
    // Short timeout to make sure the database connection is ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize the session store
    await setupSessionStore();
    
    // In production, we need to ensure cookies work with HTTPS
    if (process.env.NODE_ENV === 'production') {
      console.log('Production environment detected - configuring secure session cookies');
      app.set('trust proxy', 1); // Trust first proxy
    } else {
      console.log('Development environment detected - using non-secure cookies');
    }
    
    // Configure session middleware with environment-specific settings 
    const isProd = process.env.NODE_ENV === 'production';
    console.log(`Configuring session for ${isProd ? 'production' : 'development'} environment`);
    
    if (isProd) {
      console.log('Using production-optimized session settings with secure cookies');
    } else {
      console.log('Using development-friendly session settings');
    }
    
    app.use(session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      proxy: true, // Always trust the reverse proxy
      rolling: true, // Reset expiration countdown on every response
      name: isProd ? 'watchapp.sid' : 'watchlist.sid', // Different name for production
      
      // Environment-specific cookie settings
      cookie: {
        httpOnly: true,
        // Use secure cookies in production, but allow insecure in development
        secure: isProd ? true : false,
        // Set a reasonable session timeout
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        // Use safer lax mode in all environments
        sameSite: 'lax',
        path: '/',
        // No domain setting to work with any host
        domain: undefined
      }
    }));
    
    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());
    configurePassport();
    
    // Register auth routes after passport setup
    app.use('/api', authRoutes);
    
    // Apply authentication middleware to all API routes except auth routes
    // Apply the auth middleware globally to protected routes
    app.use('/api/watchlist', isAuthenticated, hasWatchlistAccess);
    
    // Push database schema changes before starting the server
    await pushDatabaseSchema();
    
    const server = await registerRoutes(app);

    // Add error handling middleware
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
    
    return server;
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Start the server
startServer().catch(err => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
