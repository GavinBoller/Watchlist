import express, { Request, Response } from 'express';
import session from 'express-session';
import passport from 'passport';
import cors from 'cors';
import { Pool } from 'pg';
import connectPgSimple from 'connect-pg-simple';
import { configurePassport, isAuthenticated, validateSession, hasWatchlistAccess } from './auth.js';
import authRouter from './authRoutes';
import { routes } from './routes';
import { registerEmergencyEndpoints } from './productionFixes';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure PostgreSQL pool for Neon
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true } // Required for Neon
});

// Session configuration with connect-pg-simple
const PgSession = connectPgSimple(session);
app.use(
  session({
    store: new PgSession({
      pool: pgPool,
      tableName: 'session_store' // Matches your Neon table
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());
configurePassport();

// Public routes
app.get('/api/status/ping', (req: Request, res: Response) => {
  console.log('[PING] Handling /api/status/ping');
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Custom middleware
app.use(validateSession);

// Routes
app.use('/api/auth', authRouter);
app.use('/api', isAuthenticated, hasWatchlistAccess, routes);

// Emergency endpoints
registerEmergencyEndpoints(app);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});