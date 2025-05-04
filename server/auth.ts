import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { User, UserResponse } from '../shared/schema.js';
import { IStorage, storage } from './storage.js';
import { Request, Response, NextFunction } from 'express';
import { Session } from 'express-session';

// Extend Request interface for session and user
declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    lastChecked?: number;
    createdAt?: number;
    userData?: User;
    preservedUserId?: number;
    preservedUsername?: string;
    preservedDisplayName?: string;
    userAuthenticated?: boolean;
    enhancedProtection?: boolean;
    autoLogoutPrevented?: boolean;
    preservedTimestamp?: number;
  }
}

export function configurePassport() {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) {
          return done(null, false, { message: 'Incorrect username.' });
        }

        // Check if password is defined before comparing
        if (!user.password) {
          return done(null, false, { message: 'User password not found.' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
          return done(null, false, { message: 'Incorrect password.' });
        }

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: any, done) => {
    done(null, (user as User).id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) {
        return done(null, false);
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  });
}

interface IStorageExtended extends IStorage {
  directSqlQuery?(query: string, params: any[]): Promise<any[]>;
}

export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  console.log(`[AUTH] Checking authentication for ${req.method} ${req.originalUrl}`);
  console.log(`[AUTH] Session ID: ${req.sessionID}, Authenticated: ${req.isAuthenticated()}`);

  // Allow public endpoints without authentication
  if (req.path === '/api/status/ping' || req.path.startsWith('/api/auth') || req.path.startsWith('/api/emergency')) {
    console.log(`[AUTH] Allowing public endpoint: ${req.path}`);
    return next();
  }

  const isPassportAuthenticated = req.isAuthenticated();
  const isSessionAuthenticated = req.session?.authenticated === true;
  const hasUserObject = !!req.user;

  // Restore user from session data if available
  if (req.session && !hasUserObject) {
    if (req.session.userData?.id && req.session.userData.username) {
      console.log(`[AUTH] Found userData in session for ${req.session.userData.username}`);
      req.user = {
        id: req.session.userData.id,
        username: req.session.userData.username,
        password: '', // Password not stored in session
        displayName: req.session.userData.displayName || null,
        createdAt: req.session.userData.createdAt ? new Date(req.session.userData.createdAt) : new Date(),
        environment: req.session.userData.environment || null,
      };
    } else if (req.session.preservedUserId && req.session.preservedUsername) {
      console.log(`[AUTH] Found preserved user data in session for ${req.session.preservedUsername}`);
      req.user = {
        id: req.session.preservedUserId,
        username: req.session.preservedUsername,
        password: '', // Password not stored in session
        displayName: req.session.preservedDisplayName || null,
        createdAt: new Date(),
        environment: null,
      };
      console.log(
        `[AUTH] Restored user from preserved data: ${req.session.preservedUsername} (ID: ${req.session.preservedUserId})`
      );
    }
  }

  let currentUser: UserResponse | undefined = req.user as UserResponse;

  // Check for special users
  const specialUsers = process.env.SPECIAL_USERS
    ? process.env.SPECIAL_USERS.split(',').map((name) => name.trim())
    : ['Gavinadmin', 'Gaju'];
  const isSpecialUser = currentUser && specialUsers.includes(currentUser.username);

  // If no authenticated user, reject non-public routes
  if (!isPassportAuthenticated && !isSessionAuthenticated && !currentUser) {
    if (!req.session) {
      console.log('[AUTH] No session, rejecting request');
      return res.status(401).json({
        status: 'error',
        message: 'Not authenticated',
        redirect: '/login',
      });
    }

    console.log('[AUTH] No authenticated user, logging out');
    req.logout((err) => {
      if (err) {
        console.error('[AUTH] Error during logout:', err);
      }
    });
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });
    return res.status(401).json({
      status: 'error',
      message: 'Not authenticated',
      redirect: '/login',
    });
  }

  // Update session for authenticated users
  if (req.session && currentUser) {
    req.session.authenticated = true;
    req.session.lastChecked = Date.now();
    req.session.save((err) => {
      if (err) {
        console.error('[AUTH] Error saving session:', err);
      }
    });

    res.set({
      'X-Auth-Status': 'authenticated',
      'X-Auth-User': currentUser.username,
    });

    if (isSpecialUser) {
      console.log(`[AUTH] Special user detected: ${currentUser.username}`);
      req.session.userAuthenticated = true;
      req.session.preservedUsername = currentUser.username;
      req.session.preservedUserId = currentUser.id;
      req.session.preservedTimestamp = Date.now();
      req.session.enhancedProtection = true;
      req.session.autoLogoutPrevented = true;
      return req.session.save((err) => {
        if (err) {
          console.error('[AUTH] Error saving enhanced session:', err);
          return res.status(500).json({ status: 'error', message: 'Session error' });
        }
        console.log(`[AUTH] Enhanced session saved for ${currentUser.username}, ID: ${req.sessionID}`);
        next();
      });
    }
  }

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
  });

  // Allow watchlist routes to proceed to hasWatchlistAccess
  if (req.originalUrl.includes('/watchlist')) {
    console.log('[AUTH] Watchlist route accessed, proceeding to watchlist access check');
    return next();
  }

  // Allow authenticated users to proceed
  if (currentUser) {
    console.log(`[AUTH] User ${currentUser.username} authenticated, proceeding`);
    return next();
  }

  // Fallback rejection for non-watchlist routes
  return res.status(401).json({
    status: 'error',
    message: 'Not authenticated',
    path: req.originalUrl,
  });
}

export function validateSession(req: Request, res: Response, next: NextFunction) {
  console.log(`[VALIDATE_SESSION] Processing ${req.method} ${req.path}`);
  if (req.path === '/api/status/ping' || req.path.startsWith('/api/auth') || req.path.startsWith('/api/emergency')) {
    console.log(`[VALIDATE_SESSION] Allowing public endpoint: ${req.path}`);
    return next();
  }
  if (!req.session) {
    console.log(`[VALIDATE_SESSION] No session, rejecting: ${req.path}`);
    return res.status(401).json({ status: 'error', message: 'Not authenticated', redirect: '/login' });
  }
  console.log(`[VALIDATE_SESSION] Session found, proceeding: ${req.path}`);
  next();
}

export function hasWatchlistAccess(req: Request, res: Response, next: NextFunction) {
  let requestUserId: number | undefined;

  if (req.params.userId) {
    requestUserId = parseInt(req.params.userId);
  } else if (req.body && (req.body as any).userId) {
    requestUserId = parseInt((req.body as any).userId);
  } else if (req.query && (req.query as any).userId) {
    requestUserId = parseInt((req.query as any).userId as string);
  }

  if (req.method === 'POST' && req.originalUrl === '/api/watchlist' && !(req.body as any).userId && req.user) {
    const authUser = req.user as UserResponse;
    (req.body as any).userId = authUser.id;
  }

  if (req.session) {
    console.log('[AUTH] Session data:', {
      id: req.sessionID,
      authenticated: req.session.authenticated,
      createdAt: req.session.createdAt,
      cookie: req.session.cookie,
    });
  }

  if (req.user) {
    console.log('[AUTH] User data:', {
      id: (req.user as any).id,
      username: (req.user as any).username,
    });
  }

  const preservedUserId = (req.session as any)?.preservedUserId;
  const preservedUsername = (req.session as any)?.preservedUsername;

  if (req.originalUrl.includes('/watchlist')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    });

    let isPassportAuthenticated = req.isAuthenticated();
    let isSessionAuthenticated = req.session && req.session.authenticated === true;
    let hasUserObject = !!req.user;
    let hasSpecialUserData = false;

    if (req.session) {
      if ((req.session as any).userData && (req.session as any).userData.id && (req.session as any).userData.username) {
        console.log(`[AUTH:WATCHLIST] Found userData in session for ${(req.session as any).userData.username}`);
        const userData = (req.session as any).userData;
        req.user = {
          id: userData.id,
          username: userData.username,
          password: '', // Password not stored in session
          displayName: userData.displayName || null,
          createdAt: new Date(userData.createdAt),
          environment: userData.environment || null,
        };
        hasSpecialUserData = true;
      } else if (preservedUserId && preservedUsername) {
        req.user = {
          id: preservedUserId,
          username: preservedUsername,
          password: '', // Password not stored in session
          displayName: (req.session as any).preservedDisplayName || preservedUsername,
          createdAt: new Date(),
          environment: null,
        };
        hasSpecialUserData = true;
      }
    }

    if (requestUserId) {
      const dbUser = storage.getUser(requestUserId);
      dbUser.then((user) => {
        if (!user) {
          return res.status(401).json({
            status: 'error',
            message: 'User not found',
          });
        }
        const userWithoutPassword: UserResponse = {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          createdAt: user.createdAt,
          environment: user.environment,
        };
        req.user = userWithoutPassword;
        if (req.session) {
          (req.session as any).userData = userWithoutPassword;
          (req.session as any).preservedUserId = user.id;
          (req.session as any).preservedUsername = user.username;
          req.session.authenticated = true;
          req.session.save();
        }
        next();
      }).catch((err) => {
        console.error('[AUTH] Error fetching user:', err);
        return res.status(500).json({
          status: 'error',
          message: 'Error fetching user',
        });
      });
      return;
    }

    console.log(
      `[AUTH] Watchlist authentication sources - Passport: ${isPassportAuthenticated}, Session flag: ${isSessionAuthenticated}, User object: ${
        hasUserObject || !!req.user
      }, Special user data: ${hasSpecialUserData}`
    );

    const hasUserObjectAfterRecovery = !!req.user;

    if (!isPassportAuthenticated && !isSessionAuthenticated && !hasUserObjectAfterRecovery) {
      return res.status(401).json({
        status: 'error',
        message: 'Authentication required for watchlist access',
        redirect: '/login',
      });
    }

    if ((isPassportAuthenticated || hasUserObjectAfterRecovery) && req.session) {
      req.session.authenticated = true;
      req.session.lastChecked = Date.now();
      req.session.save((err) => {
        if (err) {
          console.error('[AUTH] Error saving session:', err);
        }
      });
    }

    let currentUser = req.user as UserResponse;

    if (req.method === 'POST' && req.originalUrl === '/api/watchlist') {
      if (!(req.body as any).userId) {
        if (currentUser) {
          (req.body as any).userId = currentUser.id;
        }
      }
      if ((req.body as any).userId && (req.body as any).userId !== currentUser.id) {
        console.log(
          `[AUTH] Warning: Body userId ${(req.body as any).userId} different from authenticated user ${currentUser.id}`
        );
        if (currentUser) {
          (req.body as any).userId = currentUser.id;
        }
      }
      const bodyUserId = parseInt((req.body as any).userId as string, 10);
      if (bodyUserId && bodyUserId !== currentUser.id) {
        console.log(
          `[AUTH] Warning: Parsed body userId ${bodyUserId} different from authenticated user ${currentUser.id}`
        );
        return res.status(403).json({
          status: 'error',
          message: 'Cannot create watchlist entries for other users',
        });
      }
    }

    if (req.originalUrl.startsWith('/api/watchlist/')) {
      const pathParts = req.originalUrl.split('/');
      const pathUserId = pathParts[3] ? parseInt(pathParts[3]) : undefined;
      if (pathUserId && currentUser && pathUserId !== currentUser.id) {
        console.log(
          `[AUTH] Warning: Path userId ${pathUserId} different from authenticated user ${currentUser.id}`
        );
        return res.status(403).json({
          status: 'error',
          message: 'Cannot access watchlist entries for other users',
        });
      }
    }

    next();
  }

  next();
}