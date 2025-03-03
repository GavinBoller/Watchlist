import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  console.warn(
    "Warning: DATABASE_URL is not set. Database functionality will be unavailable."
  );
  // Don't throw an error - this will help deployment succeed even if DB is not set
}

// Use a default connection string if DATABASE_URL is not set
// This will be overridden in production with the actual DATABASE_URL
export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/dummy'
});
export const db = drizzle({ client: pool, schema });
