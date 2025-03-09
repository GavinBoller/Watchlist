import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

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
 */
function createPool(isProduction: boolean = process.env.NODE_ENV === 'production'): Pool {
  // Connection string handling with fallback
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error("ERROR: DATABASE_URL is not set. Database operations will fail.");
    throw new Error("DATABASE_URL environment variable is required");
  }
  
  console.log("Creating database pool with PostgreSQL connection...");
  
  // Use simple, reliable pool configurations
  const poolConfig = {
    connectionString,
    // Default connection limits
    max: 10,
    // Standard timeout values
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
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

// Initialize the database
initializeDatabase()
  .then(() => {
    console.log('Database connected and ready for use');
  })
  .catch(err => {
    console.error('Fatal database initialization error:', getDbErrorMessage(err));
    console.error('Application may not function correctly without database access');
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
      // If connection test fails, try to reinitialize
      try {
        await initializeDatabase();
        return true;
      } catch (reinitError) {
        console.error('[DB] Database reinitialization failed:', getDbErrorMessage(reinitError));
        return false;
      }
    }
  }
  
  // If we don't have a pool or db yet, try to initialize
  try {
    await initializeDatabase();
    return true;
  } catch (error) {
    console.error('[DB] Failed to initialize database:', getDbErrorMessage(error));
    return false;
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
): Promise<T[]> {
  if (!pool) {
    // Try to initialize database before failing
    try {
      await ensureDatabaseReady();
    } catch (error) {
      console.error('[DB] Emergency database initialization failed:', error);
    }
    
    // If still no pool, throw error
    if (!pool) {
      throw new Error('Database pool not initialized');
    }
  }
  
  let client;
  try {
    client = await pool.connect();
    const result = await client.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    console.error(`Direct SQL execution failed: ${errorMessage}`, error);
    throw new Error(`${errorMessage}: ${getDbErrorMessage(error)}`);
  } finally {
    if (client) client.release();
  }
}

// Export database access methods
export { pool, db };
