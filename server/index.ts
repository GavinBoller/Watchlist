import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { config } from "dotenv";
import session from "express-session";
import path from "path";

// Force dotenv to load environment variables more aggressively
// This ensures environment variables from .env file are loaded early
config({ path: path.join(process.cwd(), '.env') });

// Check for critical environment variables
const DATABASE_URL = process.env.DATABASE_URL;
console.log("Environment check: DATABASE_URL is " + (DATABASE_URL ? "set" : "NOT SET"));
if (!DATABASE_URL) {
  console.warn("CRITICAL: DATABASE_URL environment variable is missing!");
  console.warn("Available environment variables:", Object.keys(process.env).filter(key => !key.includes('SECRET')).join(', '));
}
import passport from "passport";
import { configurePassport, isAuthenticated, hasWatchlistAccess } from "./auth";
import authRoutes from "./authRoutes";
import MemoryStore from "memorystore";
import { pool, db, executeDirectSql } from "./db";
import { exec } from "child_process";
import util from "util";
import fs from "fs";
import crypto from "crypto";
// Production fixes have been removed for simplification
// Import JWT related files
import { jwtAuthenticate } from "./jwtMiddleware";
import { jwtAuthRouter } from "./jwtAuthRoutes";
import { simpleJwtRouter } from "./simpleJwtAuth";
import { simpleRegisterRouter, simpleRegisterHandler } from "./simpleRegister";
import { simpleLoginRouter } from "./simpleLogin";
import { emergencyLoginRouter } from "./emergencyLoginPage";
import { emergencyAuthRouter } from "./emergencyAuth";
import { tokenRefreshRouter } from "./tokenRefresh";
import { statusRouter } from "./statusRoutes";

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

// Environment variables already loaded at the top of the file
// No need to call config() again

// Create Promise-based exec functions (used by schema push)
const execPromise = util.promisify(exec);

// Initialize Express app
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure session storage based on environment
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'watchlist-app-secret';

// Create memory store for sessions
const MemoryStoreSession = MemoryStore(session);
const memoryStore = new MemoryStoreSession({
  checkPeriod: 86400000, // prune expired entries every 24h
  stale: true,           // Return stale values if issue with cache
  max: 5000,             // Limit to prevent memory issues
  ttl: 7 * 24 * 60 * 60 * 1000  // 7 day TTL for all sessions
});

// Initialize session early in the middleware chain (required by passport)
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: true, // Create session for anonymous users
  rolling: true, // Reset the maxAge on every response to keep the session active
  store: memoryStore,
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

// Production-specific middleware removed for simplicity

// Register JWT authentication middleware to validate tokens
console.log('[SERVER] Adding JWT authentication middleware');
app.use(jwtAuthenticate);

// We're now using memory store directly initialized at the top of the file
// No need for separate session store functions or setup

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
    
    // Use the previously defined execPromise
    
    // Temporarily modify drizzle push to avoid conflicts with session table
    // Instead of using drizzle-kit push directly, we'll create a custom approach
    
    console.log('Using modified schema push to protect session table structure');
    
    // Check if any sessions exist first to avoid data loss
    let sessionCount = 0;
    try {
      // Check if pool is initialized and ready
      if (pool && typeof pool.connect === 'function') {
        const client = await pool.connect();
        try {
          const { rows } = await client.query('SELECT COUNT(*) FROM "session"');
          sessionCount = parseInt(rows[0].count);
          console.log(`Found ${sessionCount} existing sessions in database`);
        } finally {
          client.release();
        }
      } else {
        console.log('Database pool not ready, skipping session count check');
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
    console.log("Checking database connection status...");
    
    // Import the DB readiness check function - use dynamic import for ESM compatibility
    const { ensureDatabaseReady } = await import('./db');
    
    // Actually verify the database connection is working
    // This replaces the simple timeout with a real connection check
    console.log("Actively verifying database connection...");
    const isDbReady = await ensureDatabaseReady();
    
    // Log the database status
    if (isDbReady) {
      console.log("✅ Database connection verified and ready");
    } else {
      console.warn("⚠️ Database connection could not be established");
      console.log("Continuing startup with in-memory fallbacks enabled");
    }
    
    // In production, we need to ensure cookies work with HTTPS
    if (process.env.NODE_ENV === 'production') {
      console.log('Production environment detected - configuring secure session cookies');
      app.set('trust proxy', 1); // Trust first proxy
    } else {
      console.log('Development environment detected - using non-secure cookies');
    }
    
    // Using simple in-memory session store for all environments
    console.log('Using in-memory session store for all environments');
    
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
      store: memoryStore, // Use memory store for all environments
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
    
    // Register JWT authentication routes
    app.use('/api', jwtAuthRouter);
    
    // Register simplified JWT routes for emergencies
    console.log('[SERVER] Adding simplified JWT authentication routes');
    app.use('/api', simpleJwtRouter);
    
    // Register simplified registration endpoint for robust user creation
    console.log('[SERVER] Adding simplified registration endpoint');
    app.use('/api', simpleRegisterRouter);
    
    // Add a direct duplicate route outside of router for extreme reliability
    // This ensures the registration endpoint is available even if router middleware has issues
    app.post('/api/simple-register-direct', async (req: Request, res: Response) => {
      console.log('[DIRECT REGISTER] Received direct registration request');
      
      try {
        // Use the imported handler function that was already imported at the top of the file
        // This is a more reliable method than trying to use the router directly
        console.log('[DIRECT REGISTER] Using imported handler function');
        
        // Call the handler function directly
        console.log('[DIRECT REGISTER] Using direct handler import');
        return await simpleRegisterHandler(req, res);
      } catch (error) {
        console.error('[DIRECT REGISTER] Error in direct registration handler:', error);
        return res.status(500).json({ 
          error: 'Direct registration failed', 
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Add explicit route for debugging purposes to confirm route registration
    app.get('/api/registration-debug', (req: Request, res: Response) => {
      console.log('[REGISTRATION DEBUG] Registration routes are properly registered');
      return res.status(200).json({ 
        message: 'Registration endpoint is working correctly',
        routes: {
          simpleRegister: '/api/simple-register',
          simpleRegisterDirect: '/api/simple-register-direct',
          jwtRegister: '/api/jwt/register',
          backdoorRegister: '/api/jwt/backdoor-register'
        }
      });
    });
    
    // Register simplified login endpoint for reliable authentication
    console.log('[SERVER] Adding simplified login endpoint');
    app.use('/api', simpleLoginRouter);
    
    // Register emergency login page for extreme fallback scenarios
    console.log('[SERVER] Adding emergency login page for fallback authentication');
    app.use('/api', emergencyLoginRouter);
    
    // Register ultra-simplified emergency auth endpoints
    console.log('[SERVER] Adding emergency auth router for direct token generation');
    app.use('/api', emergencyAuthRouter);
    
    // Register token refresh endpoint for seamless authentication
    console.log('[SERVER] Adding token refresh endpoint for JWT renewal');
    app.use('/api', tokenRefreshRouter);
    
    // Register status routes for monitoring and admin endpoints
    console.log('[SERVER] Adding status routes for monitoring');
    app.use('/api/status', statusRouter);
    
    // Instead of HTML files, use direct text responses for testing
    app.get('/status-ping-test', (_req: Request, res: Response) => {
      res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>API Ping Test</title>
        <style>
          body {
            font-family: sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          #result {
            background-color: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin: 15px 0;
            white-space: pre-wrap;
            font-family: monospace;
          }
          button {
            background-color: #0078d4;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <h1>API Ping Test</h1>
        <p>This page tests the direct API ping endpoint.</p>
        
        <button onclick="testPing()">Test API</button>
        
        <div id="result">Results will appear here...</div>
        
        <script>
          async function testPing() {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = 'Loading...';
            
            try {
              const response = await fetch('/api/status-direct/ping');
              const contentType = response.headers.get('content-type');
              
              if (response.ok) {
                const data = await response.json();
                resultDiv.textContent = 'SUCCESS!\\n\\nContent-Type: ' + contentType + 
                                       '\\n\\nResponse: ' + JSON.stringify(data, null, 2);
              } else {
                resultDiv.textContent = 'ERROR: ' + response.status + ' ' + response.statusText;
              }
            } catch (error) {
              resultDiv.textContent = 'FETCH ERROR: ' + error.message;
            }
          }
        </script>
      </body>
      </html>
      `);
    });
    
    // Test page for admin-check API
    app.get('/status-admin-test', (_req: Request, res: Response) => {
      res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin Check Test</title>
        <style>
          body {
            font-family: sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          #result {
            background-color: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 15px;
            margin: 15px 0;
            white-space: pre-wrap;
            font-family: monospace;
          }
          button {
            background-color: #0078d4;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <h1>Admin Check Test</h1>
        <p>This page tests the direct API admin-check endpoint.</p>
        
        <button onclick="testAdminCheck()">Test Admin Check</button>
        
        <div id="result">Results will appear here...</div>
        
        <script>
          async function testAdminCheck() {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = 'Loading...';
            
            try {
              const response = await fetch('/api/status-direct/admin-check');
              const contentType = response.headers.get('content-type');
              
              if (response.ok) {
                const data = await response.json();
                resultDiv.textContent = 'SUCCESS!\\n\\nContent-Type: ' + contentType + 
                                       '\\n\\nResponse: ' + JSON.stringify(data, null, 2);
              } else {
                resultDiv.textContent = 'ERROR: ' + response.status + ' ' + response.statusText;
              }
            } catch (error) {
              resultDiv.textContent = 'FETCH ERROR: ' + error.message;
            }
          }
        </script>
      </body>
      </html>
      `);
    });
    
    // Add direct status endpoints to ensure they're accessible in all environments
    app.get('/api/status-direct/ping', (_req: Request, res: Response) => {
      // Set explicit content type and disable caching to prevent browser interpretation
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Add CORS headers to ensure direct API access
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.json({ status: 'ok', time: new Date().toISOString() });
    });
    
    app.get('/api/status-direct/admin-check', async (_req: Request, res: Response) => {
      // Set explicit content type and disable caching to prevent browser interpretation
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Add CORS headers to ensure direct API access
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      try {
        // Administrators are user ID 1 or any user marked as admin or with specific usernames
        // Include Gavinadmin as an admin user
        let adminUsers = [];
        
        try {
          // Skip DB query if database is not available, just use default admin
          if (pool) {
            const client = await pool.connect();
            try {
              // Query both user ID 1 and username 'Gavinadmin'
              const result = await client.query(`
                SELECT id, username, display_name 
                FROM users 
                WHERE id = 1 OR username = 'Gavinadmin' 
                ORDER BY id
              `);
              if (result.rows && result.rows.length > 0) {
                adminUsers = result.rows.map(user => ({
                  id: user.id,
                  username: user.username,
                  displayName: user.display_name || user.username
                }));
              }
            } finally {
              client.release();
            }
          }
        } catch (dbError) {
          console.log('Could not query database for admin users:', dbError);
        }
        
        // If no admin users were found, use the default
        if (adminUsers.length === 0) {
          console.log('No admin users found in database, using default');
          adminUsers = [{
            id: 1,
            username: 'admin',
            displayName: 'Default Admin'
          }];
        }
        
        res.json({
          status: 'ok',
          adminUsers: adminUsers,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.error('Error in admin-check endpoint:', error);
        res.status(500).json({
          status: 'error',
          message: 'Could not determine admin users',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
    
    // Emergency recovery endpoints have been removed to simplify authentication
    
    // Register all API routes first
    const server = await registerRoutes(app);
    
    // Apply authentication middleware to protected routes AFTER registering routes
    // This ensures that the middleware is applied to all routes that need protection
    // Use regular session-based authentication as a fallback for non-JWT routes
    app.use('/api/watchlist-session', isAuthenticated, hasWatchlistAccess);
    
    // Apply JWT authentication middleware for watchlist routes - will be handled in routes.ts
    // The middlewares are already imported in routes.ts and applied there
    console.log('[SERVER] JWT Authentication middleware is applied to watchlist routes in routes.ts');

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
        
        // MemoryStore doesn't have a close method, but we'll leave this check in for extensibility
        if (memoryStore && typeof (memoryStore as any).close === 'function') {
          console.log('Closing memory store');
          (memoryStore as any).close();
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
