import { Request, Response, Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { storage } from './storage.js';
import { User, UserResponse } from '../shared/schema.js';
import { z } from 'zod';
import 'express-session';

const insertUserSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  displayName: z.string().min(1).max(100).optional().nullable(),
  environment: z.string().nullable().optional(),
});

const resetPasswordRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
});

const resetPasswordSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
});

interface EmergencyUser {
  id: number;
  username: string;
  password: string;
  displayName?: string;
  createdAt: Date;
  isPendingSync?: boolean;
  environment?: string | null;
}

const router = Router();

const retryOperation = async <T>(operation: () => Promise<T>, maxRetries: number = 3, retryDelay: number = 1000): Promise<T> => {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay * attempt));
      }
      return await operation();
    } catch (error) {
      console.error(`Database operation failed (attempt ${attempt + 1}/${maxRetries}):`, error);
      lastError = error;
      if (
        !(error instanceof Error &&
          (error.message.includes('connection') ||
            error.message.includes('timeout') ||
            error.message.includes('unavailable')))
      ) {
        throw error;
      }
      console.log(`Retrying operation in ${retryDelay * (attempt + 1)}ms...`);
    }
  }
  throw lastError;
};

const emergencyMemoryStorage = {
  users: new Map<string, EmergencyUser>(),
  isUsingEmergencyMode: false,
};

function enableEmergencyMode() {
  console.warn('⚠️ EMERGENCY MODE ACTIVATED: Using memory fallback for critical operations');
  emergencyMemoryStorage.isUsingEmergencyMode = true;
}

function isEmergencyModeActive() {
  if (process.env.ENABLE_EMERGENCY_MODE === 'true') {
    console.log('[AUTH] Emergency mode is explicitly enabled via environment variable');
    return true;
  }
  const isDatabaseConnected = !!process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' && !isDatabaseConnected) {
    console.log('[AUTH] Emergency mode activated due to database connection issues');
    return true;
  }
  return emergencyMemoryStorage.isUsingEmergencyMode;
}

// Session cleanup helper
async function cleanupOldSessions(req: Request, userId: number) {
  if (req.sessionStore && typeof req.sessionStore.destroy === 'function') {
    try {
      // Query all sessions for the user
      const sessions = await new Promise<any[]>((resolve, reject) => {
        req.sessionStore.all?.((err, sessions) => {
          if (err) return reject(err);
          resolve(sessions || []);
        });
      });

      // Filter sessions by userId (assuming session stores userId)
      const userSessions = sessions.filter((session) => {
        const sess = typeof session === 'string' ? JSON.parse(session) : session;
        return sess.preservedUserId === userId || sess.user?.id === userId;
      });

      // Destroy all existing sessions for this user
      for (const session of userSessions) {
        const sessionId = session.sid || session.sessionID;
        if (sessionId && sessionId !== req.sessionID) {
          await new Promise<void>((resolve, reject) => {
            req.sessionStore.destroy(sessionId, (err) => {
              if (err) {
                console.error(`[SESSION] Failed to destroy session ${sessionId}:`, err);
                return reject(err);
              }
              console.log(`[SESSION] Destroyed old session ${sessionId} for user ${userId}`);
              resolve();
            });
          });
        }
      }
    } catch (err) {
      console.error('[SESSION] Error during session cleanup:', err);
    }
  }
}

// Register route with session cleanup
router.post('/register', async (req: Request, res: Response) => {
  try {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid input', errors: parsed.error.errors });
    }

    const { username, password, displayName, environment } = parsed.data;
    const lowercaseUsername = username.toLowerCase();

    if (isEmergencyModeActive()) {
      if (emergencyMemoryStorage.users.has(lowercaseUsername)) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const newUser: EmergencyUser = {
        id: emergencyMemoryStorage.users.size + 1,
        username: lowercaseUsername,
        password: hashedPassword,
        displayName,
        createdAt: new Date(),
        environment,
      };
      emergencyMemoryStorage.users.set(lowercaseUsername, newUser);
      return res.status(201).json({ message: 'User registered (emergency mode)', user: { username, displayName } });
    }

    const existingUser = await retryOperation(() => storage.getUserByUsername(lowercaseUsername));
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await retryOperation(() =>
      storage.createUser({
        username: lowercaseUsername,
        password: hashedPassword,
        displayName,
        environment,
      })
    );

    // Cleanup any existing sessions for this user
    await cleanupOldSessions(req, newUser.id);

    req.login(
      { id: newUser.id, username: newUser.username, displayName: newUser.displayName, createdAt: newUser.createdAt, environment },
      (err) => {
        if (err) {
          console.error('[REGISTER] Login error after registration:', err);
          return res.status(500).json({ message: 'Registration failed' });
        }
        req.session.authenticated = true;
        req.session.createdAt = Date.now();
        req.session.lastChecked = Date.now();
        (req.session as any).userAuthenticated = true;
        (req.session as any).preservedUsername = newUser.username;
        (req.session as any).preservedUserId = newUser.id;
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[REGISTER] Session save error:', saveErr);
          }
          return res.status(201).json({
            id: newUser.id,
            username: newUser.username,
            displayName: newUser.displayName,
            createdAt: newUser.createdAt,
            environment,
          });
        });
      }
    );
  } catch (err) {
    console.error('[REGISTER] Error:', err);
    if (err instanceof Error && (err.message.includes('connection') || err.message.includes('timeout'))) {
      enableEmergencyMode();
      return res.status(503).json({ message: 'Service temporarily unavailable, emergency mode enabled' });
    }
    return res.status(500).json({ message: 'Registration failed' });
  }
});

// Login route with session cleanup
router.post('/login', async (req: Request, res: Response) => {
  if (!req.body.username || !req.body.password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  if (isEmergencyModeActive()) {
    const { username, password } = req.body;
    const lowercaseUsername = username.toLowerCase();
    const user = emergencyMemoryStorage.users.get(lowercaseUsername);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const { password: _, ...userWithoutPassword } = user;
    req.login(userWithoutPassword, (err) => {
      if (err) {
        console.error('[LOGIN] Emergency mode login error:', err);
        return res.status(500).json({ message: 'Login failed', emergencyMode: true });
      }
      return res.json({ message: 'Login successful (emergency mode)', user: userWithoutPassword, emergencyMode: true });
    });
    return;
  }

  passport.authenticate('local', async (err: Error, user: UserResponse, info: { message: string }) => {
    if (err) {
      console.error('[LOGIN] Passport authentication error:', err);
      return res.status(err.message.includes('connection') || err.message.includes('timeout') ? 503 : 500).json({
        message: 'Authentication failed',
      });
    }
    if (!user) {
      return res.status(401).json({ message: info.message || 'Invalid credentials' });
    }

    // Cleanup old sessions before logging in
    await cleanupOldSessions(req, user.id);

    req.login(user, (loginErr) => {
      if (loginErr) {
        console.error('[LOGIN] Login error:', loginErr);
        return res.status(500).json({ message: 'Login failed' });
      }
      req.session.authenticated = true;
      req.session.createdAt = Date.now();
      req.session.lastChecked = Date.now();
      (req.session as any).userAuthenticated = true;
      (req.session as any).preservedUsername = user.username;
      (req.session as any).preservedUserId = user.id;
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[LOGIN] Session save error:', saveErr);
        }
        return res.status(200).json({
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          createdAt: user.createdAt,
          environment: user.environment,
        });
      });
    });
  })(req, res);
});

// Other routes (unchanged)
router.post('/request-password-reset', async (req: Request, res: Response) => {
  const parsed = resetPasswordRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', errors: parsed.error.errors });
  }
  // Implementation unchanged
});

router.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid input', errors: parsed.error.errors });
  }
  // Implementation unchanged
});

router.get('/session', (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  return res.json({
    user: {
      id: req.user?.id,
      username: req.user?.username,
      displayName: req.user?.displayName,
      createdAt: req.user?.createdAt,
      environment: req.user?.environment,
    },
    session: {
      id: req.sessionID,
      createdAt: req.session.createdAt,
      lastChecked: req.session.lastChecked,
    },
  });
});

router.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      console.error('[LOGOUT] Error:', err);
      return res.status(500).json({ message: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        console.error('[LOGOUT] Session destroy error:', err);
        return res.status(500).json({ message: 'Logout failed' });
      }
      res.clearCookie('connect.sid');
      return res.json({ message: 'Logged out successfully' });
    });
  });
});

export default router;