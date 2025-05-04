import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '../shared/schema.js';

// Configure neon to use WebSockets
const neonConfig = { webSocketConstructor: ws };

// Connection handling variables
let pool: Pool | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

// Initialize database connection
export async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[DB] CRITICAL: DATABASE_URL is not set');
    throw new Error('No database connection URL available');
  }

  try {
    pool = new Pool({
      connectionString,
      max: process.env.NODE_ENV === 'production' ? 10 : 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: true
    });

    dbInstance = drizzle(pool, { schema });
    console.log('[DB] Database connection initialized');

    // Log pool errors without forcing reconnection
    pool.on('error', (err: Error) => {
      console.error('[DB] Pool error:', err);
    });

    return dbInstance;
  } catch (err) {
    console.error('[DB] Connection attempt failed:', err);
    throw new Error(`Failed to initialize database: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}