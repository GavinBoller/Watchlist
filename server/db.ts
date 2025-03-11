import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Add global db declaration for TypeScript
declare global {
  // eslint-disable-next-line no-var
  var db: ReturnType<typeof drizzle> | undefined;
}

// Configure neon to use WebSockets
neonConfig.webSocketConstructor = ws;

// Improve connection handling
let pool: Pool;
let db: ReturnType<typeof drizzle>;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
let isReconnecting = false;
let reconnectTimer: NodeJS.Timeout | null = null;

/**
 * Get a specific error message from a database error
 */
function getDbErrorMessage(error: unknown): string {
  if (!error) return 'Unknown database error';
  
  const errorString = typeof error === 'object' && error !== null
    ? error.toString()
    : String(error);
  
  if (errorString.includes('connection refused')) {
    return 'Database connection refused. The server may be down or unreachable.';
  }
  if (errorString.includes('timeout')) {
    return 'Database connection timed out. Please try again later.';
  }
  if (errorString.includes('too many clients')) {
    return 'Database server is at maximum capacity. Please try again later.';
  }
  if (errorString.includes('terminated')) {
    return 'Database connection was terminated. Please try again.';
  }
  
  return errorString;
}

/**
 * Create a database pool with appropriate settings for the current environment
 * @param isProduction Whether the pool should use production settings 
 * @param connectionTimeoutMs Custom connection timeout in milliseconds (optional)
 * @returns A configured database connection pool
 */
function createPool(
  isProduction: boolean = process.env.NODE_ENV === 'production', 
  connectionTimeoutMs: number = 10000
): Pool {
  // Connection string handling with robust fallback
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    // Log critical error but continue with initialization attempt
    console.error("CRITICAL: DATABASE_URL is not set. Attempting recovery strategy.");
    console.error("Environment variables available:", Object.keys(process.env).filter(key => !key.includes('SECRET')).join(', '));
    
    // In production deployment, different environment variable formats might be used
    const altDbUrls = [
      process.env.POSTGRES_URL,
      process.env.PG_URL, 
      process.env.POSTGRESQL_URL,
      process.env.DATABASE_URI,
      process.env.DB_URL,
      process.env.REPLIT_DB_URL
    ];
    
    const altDbUrl = altDbUrls.find(url => !!url);
    
    if (altDbUrl) {
      console.log(`Found alternative database URL in environment variable. Using this instead.`);
      return new Pool({
        connectionString: altDbUrl,
        max: 5,
        idleTimeoutMillis: 30000, 
        connectionTimeoutMillis: connectionTimeoutMs,
        ssl: isProduction ? { rejectUnauthorized: false } : undefined
      });
    }
    
    // This is a critical error but we'll continue with a warning
    console.error("WARNING: No database URL found in any environment variable. Services will be degraded.");
    throw new Error("No database connection URL available in any environment variable");
  }
  
  console.log("Creating database pool with PostgreSQL connection...");
  
  // Adjust max connections based on environment
  // In production we can use more, in development fewer to avoid connection limits
  const maxConnections = isProduction ? 10 : 5;
  
  // Use simple, reliable pool configurations
  const poolConfig = {
    connectionString,
    // Default connection limits
    max: maxConnections,
    // Standard timeout values
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: connectionTimeoutMs,
    // SSL required for cloud database providers
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  };
  
  console.log(`Creating database pool with ${poolConfig.max} max connections and ${poolConfig.connectionTimeoutMillis}ms timeout`);
  return new Pool(poolConfig);
}

/**
 * Setup connection health monitoring
 */
function setupConnectionHealthMonitoring(newPool: Pool): void {
  // Handle connection errors
  newPool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
    
    // If not already reconnecting, schedule a reconnection attempt
    if (!isReconnecting) {
      scheduleReconnect();
    }
  });
  
  // Setup periodic connection health check every 5 minutes
  // This helps detect stale connections that weren't properly closed
  setInterval(async () => {
    if (isReconnecting) return;
    
    try {
      const client = await newPool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Health check failed:', error);
      scheduleReconnect();
    }
  }, 5 * 60 * 1000); // 5 minutes
}

/**
 * Schedule a reconnection attempt with backoff
 */
function scheduleReconnect(): void {
  if (isReconnecting || reconnectTimer) return;
  
  isReconnecting = true;
  const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
  console.log(`Scheduling database reconnection in ${delay/1000} seconds...`);
  
  if (reconnectTimer) clearTimeout(reconnectTimer);
  
  reconnectTimer = setTimeout(async () => {
    try {
      await initializeDatabase();
      isReconnecting = false;
      reconnectTimer = null;
    } catch (error) {
      console.error('Reconnection failed:', error);
      isReconnecting = false;
      reconnectTimer = null;
      scheduleReconnect(); // Try again
    }
  }, delay);
}

/**
 * Initialize the database connection with simple retry logic
 */
async function initializeDatabase(): Promise<boolean> {
  try {
    // Create a new connection pool
    const isProd = process.env.NODE_ENV === 'production';
    const newPool = createPool(isProd);
    
    // Setup basic error handling on the pool
    newPool.on('error', (err) => {
      console.error('Database pool error:', err);
    });

    // Test the connection before proceeding
    let client;
    try {
      console.log('Testing database connection...');
      client = await newPool.connect();
      await client.query('SELECT 1');
      console.log('Database connection test successful');
    } catch (connErr) {
      console.error('Connection test failed:', getDbErrorMessage(connErr));
      throw connErr; // Re-throw to trigger the retry mechanism
    } finally {
      if (client) client.release();
    }

    // Once the connection is verified, update the global pool reference
    pool = newPool;
    
    // Initialize Drizzle with the pool
    db = drizzle({ client: pool, schema });
    
    // Reset connection attempts on successful connection
    connectionAttempts = 0;
    console.log('Database connection initialized successfully');
    return true;
  } catch (error) {
    console.error(`Database connection attempt ${connectionAttempts + 1} failed:`, getDbErrorMessage(error));
    
    // Use a simple retry mechanism - try up to 3 times with a short delay
    if (connectionAttempts < 3) {
      connectionAttempts++;
      const delay = 1000 * connectionAttempts; // 1s, 2s, 3s delay
      console.log(`Retrying database connection in ${delay/1000} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return initializeDatabase();
    } else {
      // After 3 tries, give up and report the error
      console.error('Max connection attempts reached. Database is unavailable.');
      throw new Error('Could not connect to database after multiple attempts');
    }
  }
}

// Initialize the database with better error handling and retry logic
initializeDatabase()
  .then(() => {
    console.log('Database connected and ready for use');
    
    // Export the db instance for global use
    // This line is critical to ensure the db is available to all parts of the application
    (global as any).db = db;
    
    // Log successful Drizzle ORM setup
    console.log('Drizzle ORM initialized with database connection');
    
    // Add a simple health check timer to ensure connection stays alive
    setInterval(async () => {
      try {
        await ensureDatabaseReady();
        // No need to log success on every check to reduce noise
      } catch (error) {
        console.error('Database health check failed:', error);
      }
    }, 60000); // Check every minute
  })
  .catch(err => {
    console.error('Fatal database initialization error:', getDbErrorMessage(err));
    console.error('Application may not function correctly without database access');
    console.error('Will attempt to recover on first operation');
  });

// Add a function to check if the database is ready
export async function ensureDatabaseReady(): Promise<boolean> {
  // If we already have a pool and db, check they're connected
  if (pool && db) {
    try {
      // Test the connection with a simple query
      const client = await pool.connect();
      try {
        await client.query('SELECT 1');
        console.log('[DB] Database connection verified');
        return true;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[DB] Database connection test failed:', getDbErrorMessage(error));
      
      // Enhanced error diagnosis
      if (error instanceof Error) {
        console.error(`[DB] Error type: ${error.name}, Message: ${error.message}`);
        console.error(`[DB] Stack: ${error.stack?.substring(0, 200)}...`);
      }
      
      console.log('[DB] Attempting database connection recovery...');
      
      // If connection test fails, try to reinitialize
      try {
        // Re-initialize the database with default settings
        await initializeDatabase();
        console.log('[DB] Database connection successfully recovered');
        return true;
      } catch (reinitError) {
        console.error('[DB] Database reinitialization failed:', getDbErrorMessage(reinitError));
        
        // Attempt one more time with increased timeout
        try {
          console.log('[DB] Attempting final recovery with increased timeout...');
          // Create a new pool with increased timeout
          const emergencyPool = createPool(process.env.NODE_ENV === 'production', 30000);
          const emergencyClient = await emergencyPool.connect();
          try {
            await emergencyClient.query('SELECT 1');
            
            // If successful, replace the existing pool
            pool = emergencyPool;
            db = drizzle({ client: pool, schema });
            (global as any).db = db;
            
            console.log('[DB] Emergency recovery successful');
            return true;
          } finally {
            emergencyClient.release();
          }
        } catch (finalError) {
          console.error('[DB] All recovery attempts failed:', getDbErrorMessage(finalError));
          return false;
        }
      }
    }
  }
  
  // If we don't have a pool or db yet, try to initialize
  console.log('[DB] No existing database connection, initializing...');
  try {
    // Initialize with default settings
    await initializeDatabase();
    console.log('[DB] Database initialized successfully');
    return true;
  } catch (error) {
    console.error('[DB] Failed to initialize database:', getDbErrorMessage(error));
    
    // One last attempt with increased timeout
    try {
      console.log('[DB] Attempting initialization with increased timeout...');
      // Create a new pool with increased timeout
      const emergencyPool = createPool(process.env.NODE_ENV === 'production', 30000);
      const emergencyClient = await emergencyPool.connect();
      try {
        await emergencyClient.query('SELECT 1');
        
        // If successful, use this pool
        pool = emergencyPool;
        db = drizzle({ client: pool, schema });
        (global as any).db = db;
        
        console.log('[DB] Emergency initialization successful');
        return true;
      } finally {
        emergencyClient.release();
      }
    } catch (finalError) {
      console.error('[DB] All initialization attempts failed:', getDbErrorMessage(finalError));
      return false;
    }
  }
}

/**
 * Direct SQL execution for critical operations when ORM fails
 * This provides a low-level fallback when the Drizzle ORM encounters issues
 */
export async function executeDirectSql<T = any>(
  sql: string, 
  params: any[] = [],
  errorMessage: string = 'Database operation failed'
): Promise<{rows: T[], rowCount: number}> {
  if (!pool) {
    // Try to initialize database before failing
    try {
      await ensureDatabaseReady();
    } catch (error) {
      console.error('[DB] Emergency database initialization failed:', error);
    }
    
    // If still no pool, throw error
    if (!pool) {
      // Return empty result set instead of throwing
      return {
        rows: [],
        rowCount: 0
      };
    }
  }
  
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount
    };
  } catch (error) {
    console.error(`Direct SQL execution failed: ${errorMessage}`, error);
    // Return empty result set instead of throwing
    return {
      rows: [],
      rowCount: 0
    };
  } finally {
    if (client) client.release();
  }
}

// Export database access methods
export { pool, db };
