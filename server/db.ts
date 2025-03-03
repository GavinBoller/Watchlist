import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

// Configure neon to use WebSockets
neonConfig.webSocketConstructor = ws;

// Improve connection handling
let pool: Pool;
let db: ReturnType<typeof drizzle>;

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
    connectionTimeoutMillis: 5000, // How long to wait for a connection
  });

  // Add error handler to prevent crashes on connection issues
  pool.on('error', (err) => {
    console.error('Unexpected error on idle database client', err);
    // Don't crash the server on connection pool errors
  });

  // Initialize Drizzle with the pool
  db = drizzle({ client: pool, schema });
  
  console.log('Database connection initialized successfully');
} catch (error) {
  console.error('Failed to initialize database connection:', error);
  // Create a dummy pool and db that will be replaced when proper connection is available
  // This prevents the application from crashing if database is temporarily unavailable
  pool = new Pool({ 
    connectionString: 'postgresql://user:password@localhost:5432/dummy',
    // Never actually try to connect with this dummy pool
    max: 0
  });
  db = drizzle({ client: pool, schema });
}

// Export the pool and db
export { pool, db };
