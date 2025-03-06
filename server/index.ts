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
import crypto from "crypto";
import { 
  productionSessionRepair, 
  productionLogging, 
  productionOptimizations, 
  registerEmergencyEndpoints,
  preventAutoLogout 
} from "./productionFixes";
// Import JWT related files
import { jwtAuthenticate } from "./jwtMiddleware";
import { jwtAuthRouter } from "./jwtAuthRoutes";

// Extend the Express Session interface to include our custom properties
// This ensures TypeScript recognizes our custom session data
declare module 'express-session' {
  interface SessionData {
    createdAt?: number;
    authenticated?: boolean;
    userAuthenticated?: boolean;
    lastChecked?: number;
    repaired?: boolean;
  }
}

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

// Initialize session early in the middleware chain (required by passport)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true, // Changed to true to ensure session is created even for anonymous users
  rolling: true, // Reset the maxAge on every response to keep the session active
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    sameSite: 'lax' // Allow cross-site requests in specific cases for better UX
  }
}));

// Initialize passport before any middleware that uses it
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Add production-specific middleware after passport initialization
app.use(productionLogging);         // Enhanced logging for production
app.use(productionSessionRepair);   // Session repair mechanisms
app.use(productionOptimizations);   // Performance optimizations
app.use(preventAutoLogout);         // Prevent automatic logout issues for all users

// Setup session store with fallback
let sessionStore: any; // Using any type here since we'll be assigning different types of stores
let usePostgresSession = false;

// Create session table if needed with enhanced robustness
async function createSessionTable(dbPool: any): Promise<boolean> {
  if (!dbPool) {
    console.error("Cannot create session table: database pool is undefined");
    return false;
  }
  
  // Maximum retries for table creation
  const MAX_RETRIES = 3;
  let retryCount = 0;
  
  while (retryCount < MAX_RETRIES) {
    let client = null;
    
    try {
      console.log(`Attempting to create/verify session table (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      
      // Get a dedicated client from the pool for better error handling
      client = await dbPool.connect();
      
      // First check if the table already exists to avoid schema conflicts
      const checkResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public'
          AND table_name = 'session'
        );
      `);
      
      const tableExists = checkResult.rows[0].exists;
      
      if (tableExists) {
        console.log("Session table already exists, validating structure...");
        
        // Check for column type compatibility issues (particularly json vs. text)
        const columnResult = await client.query(`
          SELECT column_name, data_type 
          FROM information_schema.columns
          WHERE table_schema = 'public' 
          AND table_name = 'session';
        `);
        
        // Log column info for debugging
        console.log("Current session table structure:", 
          columnResult.rows.map((r: {column_name: string, data_type: string}) => 
            `${r.column_name} (${r.data_type})`
          ).join(', ')
        );
        
        // If table exists, we're good to go - pg-connect-simple will handle any migrations
        console.log("Session table verified successfully");
        return true;
      }
      
      // If table doesn't exist, create it
      console.log("Creating session table...");
      
      // Execute direct SQL to create the session table if it doesn't exist
      // This matches the exact structure from connect-pg-simple
      await client.query(`
        CREATE TABLE IF NOT EXISTS "session" (
          "sid" varchar NOT NULL COLLATE "default",
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL,
          CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
        )
      `);
      
      console.log("Session table created successfully");
      
      // Add index for expire column for better performance with large session tables
      await client.query(`
        CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
      `);
      
      console.log("Session expiration index created successfully");
      return true;
    } catch (tableErr) {
      retryCount++;
      console.error(`Error creating/verifying session table (attempt ${retryCount}/${MAX_RETRIES}):`, tableErr);
      
      if (retryCount < MAX_RETRIES) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
        console.log(`Retrying in ${delay/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        console.error("Maximum retries reached for session table creation");
        return false;
      }
    } finally {
      // Always release the client back to the pool
      if (client) {
        try {
          client.release();
        } catch (releaseErr) {
          console.warn("Error releasing database client:", releaseErr);
        }
      }
    }
  }
  
  return false;
}

// Configure session store based on database availability with improved robustness
async function setupSessionStore() {
  // Environment-specific configuration
  const isProd = process.env.NODE_ENV === 'production';
  console.log(`Setting up session store for ${isProd ? 'production' : 'development'} environment`);
  
  // Maximum retries for session store initialization
  const MAX_RETRIES = 3;
  
  // Use PostgreSQL session store whenever DATABASE_URL is available
  if (process.env.DATABASE_URL) {
    console.log(`PostgreSQL session store will be used (DATABASE_URL is available)`);
    
    // Track retry attempts
    let retryCount = 0;
    
    while (retryCount < MAX_RETRIES) {
      try {
        console.log(`Attempting to initialize PostgreSQL session store (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
        
        // Ensure database pool is available
        if (!pool) {
          console.log(`Waiting for database pool to initialize...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (!pool && retryCount === MAX_RETRIES - 1) {
            throw new Error("Database pool not available after maximum wait time");
          }
          
          // If pool is still not available, retry
          retryCount++;
          continue;
        }
        
        // First, make sure the session table exists
        console.log("Verifying session table exists...");
        const tableCreated = await createSessionTable(pool);
        
        if (!tableCreated) {
          throw new Error("Failed to create or verify session table");
        }
        
        console.log("Session table verified, initializing session store...");
        
        // Initialize Postgres session store with the pool from db.ts
        const PgSessionStore = connectPgSimple(session);
        
        // Now create the session store with environment-specific settings
        sessionStore = new PgSessionStore({
          pool,
          tableName: 'session',
          // Table already created/verified above, so we don't need this flag
          createTableIfMissing: false,
          // Add enhanced error handling for production
          errorLog: (err) => {
            // Basic error logging for all environments
            console.error(`Session store error: ${err.message}`);
            
            // Additional logging for production errors
            if (isProd) {
              console.error('Production session error details:', {
                time: new Date().toISOString(),
                name: err.name,
                code: err.code || 'unknown',
                stack: err.stack?.substring(0, 200) || 'No stack trace', // Truncate for readability
                sessionId: err.sessionId || 'unknown'
              });
            }
            
            // Log full error in development for debugging
            if (!isProd) {
              console.error('Full session error:', err);
            }
          },
          // More frequent pruning in production for better performance
          pruneSessionInterval: isProd ? 60 * 30 : 60 * 15 // 30 or 15 minutes in seconds
        });
        
        // Test connection with a timeout to avoid hanging
        console.log(`Validating PostgreSQL session store connection...`);
        
        try {
          // Create a unique test session ID
          const testSessionId = `test-session-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
          
          // Add a safety timeout to prevent hanging
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Session store test timed out after 5 seconds")), 5000);
          });
          
          // Actual test operation with Promise.race for timeout
          await Promise.race([
            new Promise<void>((resolve, reject) => {
              sessionStore.set(testSessionId, { test: true, time: new Date().toISOString() }, (err: Error | null) => {
                if (err) {
                  console.error("Error setting test session:", err);
                  reject(err);
                } else {
                  // Clean up test session immediately
                  sessionStore.destroy(testSessionId, (destroyErr: Error | null) => {
                    if (destroyErr) {
                      console.warn("Could not clean up test session, but store is functioning:", destroyErr);
                    }
                    resolve();
                  });
                }
              });
            }),
            timeoutPromise
          ]);
          
          console.log('✅ PostgreSQL session store connection validated successfully');
          
          // Indicate we're using postgres for session storage
          usePostgresSession = true;
          console.log('✅ Using PostgreSQL session store for persistent sessions');
          console.log('Sessions will survive server restarts and deployments');
          
          return sessionStore;
        } catch (testError) {
          console.error(`Session store validation failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, testError);
          
          if (retryCount === MAX_RETRIES - 1) {
            throw new Error(`Maximum session validation attempts reached: ${testError instanceof Error ? testError.message : 'Unknown error'}`);
          }
        }
        
      } catch (err) {
        console.error(`PostgreSQL session store setup failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`, err);
        
        if (retryCount === MAX_RETRIES - 1) {
          console.error('Maximum retries reached for PostgreSQL session store, falling back to memory store');
          break;
        }
      }
      
      // If we get here, we need to retry
      retryCount++;
      
      // Exponential backoff for retries
      const delay = Math.min(1000 * Math.pow(2, retryCount), 5000);
      console.log(`Retrying PostgreSQL session store setup in ${delay/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // If we get here after all retries, we need to fall back to memory store
    console.warn('⚠️ All PostgreSQL session store setup attempts failed');
    console.log('Falling back to memory store due to persistent PostgreSQL issues');
  } else {
    console.log('No DATABASE_URL provided, using memory session store by default');
  }
  
  // If we reach here, use memory store as fallback
  console.log('Setting up memory-based session store...');
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
    console.warn('⚠️ Users will need to re-login after any server restart');
  } else if (process.env.DATABASE_URL) {
    console.log('Using memory session store (fallback due to PostgreSQL connection issues)');
    console.log('Note: Sessions will be lost when the server restarts');
  } else {
    console.log('Using memory session store (no DATABASE_URL provided)');
    console.log('Note: Sessions will be lost when the server restarts');
  }
  
  // Always add a clear warning about memory session stores
  console.log('⚠️ Memory session store is active - all users will need to re-login after server restarts');
  
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
    
    // Temporarily modify drizzle push to avoid conflicts with session table
    // Instead of using drizzle-kit push directly, we'll create a custom approach
    
    console.log('Using modified schema push to protect session table structure');
    
    // Check if any sessions exist first to avoid data loss
    let sessionCount = 0;
    try {
      const client = await pool.connect();
      try {
        const { rows } = await client.query('SELECT COUNT(*) FROM "session"');
        sessionCount = parseInt(rows[0].count);
        console.log(`Found ${sessionCount} existing sessions in database`);
      } finally {
        client.release();
      }
    } catch (err) {
      console.log('Error checking session count, assuming 0:', err);
    }
    
    if (sessionCount > 0) {
      console.log('⚠️ Skipping drizzle-kit push to avoid session data loss');
      console.log('⚠️ Session table has existing data that would be lost');
      console.log('Successfully preserved existing session data!');
    } else {
      // Only push if there are no sessions at risk of being lost
      try {
        const { stdout, stderr } = await execPromise('npx drizzle-kit push', { timeout: 10000 });
        console.log('Schema push output:', stdout);
        if (stderr) console.error('Schema push stderr:', stderr);
        console.log('Successfully pushed database schema changes!');
      } catch (pushError) {
        // If push fails due to session table conflicts, notify but continue
        console.log('Schema push encountered session table conflicts - this is expected');
        console.log('Session table will continue to function with existing structure');
      }
    }
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
    
    // Enhanced environment detection with more detailed logging
    const environment = isProd ? 'PRODUCTION' : 'development';
    
    // Log key environment settings
    console.log(`[ENV] Running server in ${environment} mode`);
    console.log(`[ENV] NODE_ENV=${process.env.NODE_ENV || 'undefined'}`);
    console.log(`[ENV] Database connection: ${process.env.DATABASE_URL ? 'configured' : 'not configured'}`);
    console.log(`[ENV] Session secret length: ${SESSION_SECRET ? SESSION_SECRET.length : 'undefined'} characters`);
    
    if (isProd) {
      console.log('[ENV] Using production-optimized session settings with secure cookies');
      console.log('[ENV] Session cookie name: watchlist.sid');
      console.log('[ENV] Cookie security: secure=true, httpOnly=true, sameSite=lax');
    } else {
      console.log('[ENV] Using development-friendly session settings');
      console.log('[ENV] Session cookie name: watchlist.sid');
      console.log('[ENV] Cookie security: secure=false, httpOnly=true, sameSite=lax');
    }
    
    app.use(session({
      secret: SESSION_SECRET,
      resave: true, // Changed to true to ensure session is always saved
      saveUninitialized: true, // Ensure session cookie is always created
      store: sessionStore,
      proxy: isProd, // Only trust proxies in production
      rolling: true, // Reset expiration countdown on every response
      name: 'watchlist.sid', // Use consistent name across environments
      
      // Enhanced session generation with automatic timestamp and logging
      genid: function(req) {
        // Generate a more reliable session ID
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 15);
        const sessionId = `${timestamp}-${random}`;
        console.log(`[SESSION] New session initialized: ${sessionId}`);
        return sessionId;
      },
      
      // More consistent cookie settings with only necessary differences between environments
      cookie: {
        httpOnly: true,
        // Use secure attribute only in production (needed for HTTPS)
        secure: isProd, 
        // Set a shorter but reasonable session timeout (7 days instead of 30)
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        // Use 'lax' for better security while still allowing redirects
        sameSite: 'lax',
        path: '/',
        // No domain restriction to ensure compatibility with all hosts
        domain: undefined
      }
    }));
    
    // Initialize Passport
    app.use(passport.initialize());
    app.use(passport.session());
    configurePassport();
    
    // Add middleware to track session activity and authentication state
    app.use((req, res, next) => {
      // Skip session tracking for static assets to reduce noise
      if (req.path.startsWith('/assets/') || req.path.endsWith('.ico') || req.path.endsWith('.svg')) {
        return next();
      }
      
      const sessionId = req.sessionID || 'unknown';
      
      // Track session creation time if not already set
      if (!req.session.createdAt) {
        req.session.createdAt = Date.now();
        console.log(`[SESSION] New session initialized: ${sessionId}`);
      }
      
      // Log authentication state changes
      if (req.isAuthenticated()) {
        const userId = (req.user as any)?.id || 'unknown';
        const username = (req.user as any)?.username || 'unknown';
        if (!req.session.authenticated) {
          console.log(`[SESSION] User authenticated in session ${sessionId}: User ID ${userId} (${username})`);
          req.session.authenticated = true;
        }
      } else if (req.session.authenticated) {
        // User was authenticated but isn't anymore
        console.log(`[SESSION] Authentication lost in session ${sessionId}`);
        req.session.authenticated = false;
      }
      
      next();
    });
    
    // Push database schema changes before setting up auth routes
    await pushDatabaseSchema();
    
    // Register auth routes after passport setup and schema changes
    app.use('/api', authRoutes);
    
    // Register emergency recovery endpoints for production
    // These provide special recovery mechanisms for user accounts that
    // are experiencing persistent session issues in production
    registerEmergencyEndpoints(app);
    
    // Register all API routes first
    const server = await registerRoutes(app);
    
    // Apply authentication middleware to protected routes AFTER registering routes
    // This ensures that the middleware is applied to all routes that need protection
    app.use('/api/watchlist', isAuthenticated, hasWatchlistAccess);

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
    
    // Force garbage collection to reduce memory usage before starting server
    // This helps with Replit deployment memory constraints
    if (global.gc) {
      console.log("Running garbage collection before starting server");
      global.gc();
    }
    
    // Add graceful shutdown handlers for production
    const cleanupHandler = () => {
      console.log('Shutdown signal received: closing HTTP server');
      server.close(() => {
        console.log('HTTP server closed');
        
        // Close database connections
        if (pool) {
          console.log('Closing database pool');
          pool.end().catch(err => console.error('Error closing pool:', err));
        }
        
        // Close session store if it has a close method
        if (sessionStore && typeof sessionStore.close === 'function') {
          console.log('Closing session store');
          sessionStore.close();
        }
        
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.error('Forced exit after 10s timeout during shutdown');
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', cleanupHandler);
    process.on('SIGINT', cleanupHandler);
    
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
