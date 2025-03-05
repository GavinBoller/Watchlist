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
  const connectionString = process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dummy';
  
  // Use different pool configurations based on environment
  const poolConfig = {
    connectionString,
    // Use different connection limits for production vs development
    max: isProduction ? 5 : 10,
    // How long a client is allowed to remain idle before being closed
    idleTimeoutMillis: 30000,
    // How long to wait for a connection to become available
    connectionTimeoutMillis: isProduction ? 15000 : 10000,
    // Max number of connection attempts per client
    maxUses: 5000, // Recycle connections after 5000 uses
    // SSL required for most cloud database providers
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
 * Initialize the database connection with retries
 */
async function initializeDatabase(): Promise<boolean> {
  try {
    if (!process.env.DATABASE_URL) {
      console.warn(
        "Warning: DATABASE_URL is not set. Using fallback connection string for development."
      );
    }

    // Create a new connection pool
    const isProd = process.env.NODE_ENV === 'production';
    const newPool = createPool(isProd);
    
    // Setup health monitoring on the new pool
    setupConnectionHealthMonitoring(newPool);

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
    
    // For serious connection issues, retry a few times with exponential backoff
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      connectionAttempts++;
      const delay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000); // Max 30 second delay
      console.log(`Retrying database connection in ${delay/1000} seconds...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return initializeDatabase();
    } else {
      console.error('Max connection attempts reached. Using fallback database configuration.');
      
      // Create a dummy pool and db that will be replaced when proper connection is available
      // This prevents the application from crashing if database is temporarily unavailable
      if (!pool) {
        pool = new Pool({ 
          connectionString: 'postgresql://user:password@localhost:5432/dummy',
          // Never actually try to connect with this dummy pool
          max: 0
        });
        db = drizzle({ client: pool, schema });
      }
      
      // Schedule a reconnection attempt in the background
      scheduleReconnect();
      return false;
    }
  }
}

// Initialize the database with retries
initializeDatabase().then(success => {
  if (success) {
    console.log('Database ready for use');
  } else {
    console.warn('Using fallback database configuration. Some features may not work properly.');
    console.log('The application will automatically reconnect when the database becomes available.');
  }
}).catch(err => {
  console.error('Fatal database initialization error:', getDbErrorMessage(err));
});

// Export the pool and db
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
    throw new Error('Database pool not initialized');
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
