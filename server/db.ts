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

async function initializeDatabase() {
  try {
    if (!process.env.DATABASE_URL) {
      console.warn(
        "Warning: DATABASE_URL is not set. Using fallback connection string for development."
      );
    }

    // Use a default connection string if DATABASE_URL is not set
    // This allows the application to start during deployment before environment variables are set
    pool = new Pool({ 
      connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dummy',
      // Add connection handling parameters
      max: 10, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
      connectionTimeoutMillis: 10000, // Increased timeout for production environments
    });

    // Add error handler to prevent crashes on connection issues
    pool.on('error', (err) => {
      console.error('Unexpected error on idle database client', err);
      // Don't crash the server on connection pool errors
    });

    // Test the connection before proceeding
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      console.log('Database connection test successful');
    } finally {
      client.release();
    }

    // Initialize Drizzle with the pool
    db = drizzle({ client: pool, schema });
    
    console.log('Database connection initialized successfully');
    return true;
  } catch (error) {
    console.error(`Database connection attempt ${connectionAttempts + 1} failed:`, error);
    
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
      pool = new Pool({ 
        connectionString: 'postgresql://user:password@localhost:5432/dummy',
        // Never actually try to connect with this dummy pool
        max: 0
      });
      db = drizzle({ client: pool, schema });
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
  }
}).catch(err => {
  console.error('Fatal database initialization error:', err);
});

// Export the pool and db
export { pool, db };
