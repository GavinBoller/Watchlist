require('dotenv').config();
console.log('[INDEX] Loaded .env:', process.env.DATABASE_URL ? 'Success' : 'Failed');
console.log('[INDEX] DATABASE_URL:', process.env.DATABASE_URL);
console.log('[INDEX] SESSION_SECRET:', process.env.SESSION_SECRET);
console.log('[INDEX] NODE_ENV:', process.env.NODE_ENV);

const expressLib = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const passport = require('passport');
const auth = require('./auth.js');
const authRoutes = require('./authRoutes.js');
const routes = require('./routes.js');
const statusRoutes = require('./statusRoutes.js');
let productionFixes;

try {
  productionFixes = require('./productionFixes.js');
  console.log('[INDEX] productionFixes loaded:', productionFixes);
} catch (err) {
  console.error('[INDEX] Error loading productionFixes:', err);
  productionFixes = { registerEmergencyEndpoints: () => null };
}

let emergencyAuth;
try {
  emergencyAuth = require('./emergencyAuth.js');
  console.log('[INDEX] emergencyAuth loaded:', emergencyAuth);
} catch (err) {
  console.error('[INDEX] Error loading emergencyAuth:', err);
  emergencyAuth = { emergencyAuthRouter: expressLib.Router() };
}

const emergencyLoginPage = require('./emergencyLoginPage.js');
const tokenRefresh = require('./tokenRefresh.js');
const schema = require('./shared/schema.js');
const db = require('./db.js');

import { Request, Response, NextFunction } from 'express';

const app = expressLib();

app.use(expressLib.json());
app.use(expressLib.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);

app.use(
  session({
    store: new PgSession({
      pool: db.pgPool,
      tableName: 'session_store',
      createTableIfMissing: true,
      schema,
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  })
);

app.use(passport.initialize());
app.use(passport.session());

try {
  auth.configurePassport();
  console.log('[INDEX] Passport configured');
} catch (err) {
  console.error('[INDEX] Error configuring passport:', err);
}

// Public routes
console.log('[INDEX] Mounting public routes...');
console.log('[INDEX] emergencyAuth.emergencyAuthRouter:', emergencyAuth.emergencyAuthRouter);
if (emergencyAuth.emergencyAuthRouter && typeof emergencyAuth.emergencyAuthRouter === 'function') {
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    console.log('[INDEX] Handling emergencyAuth route:', req.path);
    try {
      emergencyAuth.emergencyAuthRouter(req, res, next);
    } catch (err) {
      console.error('[INDEX] emergencyAuth error:', err);
      res.status(500).json({ status: 'error', message: 'Server error' });
    }
  });
} else {
  console.error('[INDEX] Error: emergencyAuth.emergencyAuthRouter is not a valid router:', emergencyAuth.emergencyAuthRouter);
}

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  console.log('[INDEX] Handling emergencyLoginPage route:', req.path);
  try {
    emergencyLoginPage.emergencyLoginRouter(req, res, next);
  } catch (err) {
    console.error('[INDEX] emergencyLoginPage error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

app.use('/api/auth', (req: Request, res: Response, next: NextFunction) => {
  console.log('[INDEX] Handling authRoutes route:', req.path);
  try {
    authRoutes(req, res, next);
  } catch (err) {
    console.error('[INDEX] authRoutes error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// Authentication middleware
console.log('[INDEX] Applying authentication middleware...');
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log('[INDEX] Applying validateSession for:', req.path);
  try {
    auth.validateSession(req, res, next);
  } catch (err) {
    console.error('[INDEX] validateSession error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log('[INDEX] Applying isAuthenticated for:', req.path);
  try {
    auth.isAuthenticated(req, res, next);
  } catch (err) {
    console.error('[INDEX] isAuthenticated error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log('[INDEX] Applying hasWatchlistAccess for:', req.path);
  try {
    auth.hasWatchlistAccess(req, res, next);
  } catch (err) {
    console.error('[INDEX] hasWatchlistAccess error:', err);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// Protected routes
console.log('[INDEX] productionFixes:', productionFixes);
if (productionFixes && productionFixes.registerEmergencyEndpoints) {
  const emergencyRouter = productionFixes.registerEmergencyEndpoints();
  console.log('[INDEX] emergencyRouter:', emergencyRouter);
  if (emergencyRouter && typeof emergencyRouter === 'function') {
    app.use('/emergency', emergencyRouter);
  } else {
    console.error('[INDEX] Error: productionFixes.registerEmergencyEndpoints() is not a valid router:', emergencyRouter);
  }
} else {
  console.error('[INDEX] Error: productionFixes.registerEmergencyEndpoints is missing:', productionFixes);
}

console.log('[INDEX] tokenRefresh:', tokenRefresh);
if (tokenRefresh && tokenRefresh.tokenRefreshRouter && typeof tokenRefresh.tokenRefreshRouter === 'function') {
  app.use('/refresh', tokenRefresh.tokenRefreshRouter);
} else {
  console.error('[INDEX] Error: tokenRefresh.tokenRefreshRouter is not a valid router:', tokenRefresh);
}

app.use('/api', routes);
app.use('/api/status', statusRoutes);

app.get('/', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Server running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;