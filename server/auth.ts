import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { User, UserResponse } from '@shared/schema';
import { storage } from './storage';

// Configure Passport with Local Strategy and robust error handling
export function configurePassport() {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        console.log(`[AUTH] Login attempt for username: ${username}`);
        
        // Get user with enhanced error handling
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          console.log(`[AUTH] Login failed: No user found with username ${username}`);
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        console.log(`[AUTH] Found user for login attempt: ${user.username} (ID: ${user.id})`);
        
        // Check password with additional logging
        let isPasswordValid = false;
        try {
          isPasswordValid = await bcrypt.compare(password, user.password);
          console.log(`[AUTH] Password validation result: ${isPasswordValid ? 'success' : 'failure'}`);
        } catch (bcryptError) {
          console.error('[AUTH] bcrypt error during password validation:', bcryptError);
          return done(null, false, { message: 'Authentication error during password validation' });
        }
        
        if (!isPasswordValid) {
          console.log(`[AUTH] Login failed: Invalid password for user ${username}`);
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        console.log(`[AUTH] Login successful for user: ${user.username} (ID: ${user.id})`);
        return done(null, userWithoutPassword);
      } catch (error) {
        console.error('[AUTH] Error during authentication:', error);
        return done(error);
      }
    })
  );
  
  // User serialization for session with enhanced debugging
  passport.serializeUser((user, done) => {
    try {
      const userId = (user as UserResponse).id;
      console.log(`[AUTH] Serializing user ID: ${userId} to session`);
      done(null, userId);
    } catch (error) {
      console.error('[AUTH] Error serializing user:', error);
      done(error);
    }
  });
  
  // User deserialization with enhanced error handling and logging
  passport.deserializeUser(async (id: number, done) => {
    try {
      console.log(`[AUTH] Deserializing user from session. ID: ${id}`);
      
      // Add retry logic for transient database issues
      let retries = 2;
      let user = null;
      let lastError = null;
      
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          user = await storage.getUser(id);
          break; // If successful, exit the retry loop
        } catch (fetchError) {
          console.error(`[AUTH] Error fetching user on attempt ${attempt + 1}/${retries + 1}:`, fetchError);
          lastError = fetchError;
          
          // Only retry on connection errors, not on logical errors
          if (fetchError instanceof Error && 
              !(fetchError.message.includes('connection') || 
                fetchError.message.includes('timeout'))) {
            break;
          }
          
          // Small delay before retry (50ms * attempt)
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
      }
      
      // If we still have no user after retries, check if it was due to an error
      if (!user) {
        if (lastError) {
          console.error('[AUTH] All retries failed when deserializing user:', lastError);
          // Don't pass the error to done() as it would break the session
          // Instead, return false to invalidate the session
          console.log('[AUTH] Invalidating session due to persistent database error');
          return done(null, false);
        }
        
        console.log(`[AUTH] User not found during session deserialization. ID: ${id}`);
        return done(null, false);
      }
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      console.log(`[AUTH] Successfully deserialized user: ${user.username} (ID: ${user.id})`);
      done(null, userWithoutPassword);
    } catch (error) {
      console.error('[AUTH] Unhandled error in deserializeUser:', error);
      // Don't pass the error to done() as it would break the session
      // Instead, return false to invalidate the session
      console.log('[AUTH] Invalidating session due to unhandled error');
      done(null, false);
    }
  });
}

// Middleware to check if user is authenticated with enhanced debugging
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  // Log authentication check for debugging
  console.log(`[AUTH] Checking authentication for ${req.method} ${req.path}`);
  console.log(`[AUTH] Session ID: ${req.sessionID}, Authenticated: ${req.isAuthenticated()}`);
  
  // Verify authentication and session integrity
  if (req.isAuthenticated() && req.user) {
    // Log detailed information for successful authentication
    const user = req.user as UserResponse;
    console.log(`[AUTH] Access granted for user: ${user.username} (ID: ${user.id})`);
    
    // Additional validation: verify the session contains the expected user data
    if (!user.id) {
      console.error('[AUTH] Session anomaly: User object missing ID');
      // Force user to re-authenticate
      req.logout((err) => {
        if (err) console.error('[AUTH] Error during forced logout:', err);
      });
      return res.status(401).json({ 
        message: 'Session error: Please login again',
        code: 'SESSION_CORRUPTED'
      });
    }
    
    // Session and user are valid, proceed
    return next();
  }
  
  // Handle unauthenticated access attempts with context-specific messages
  if (req.path.includes('/watchlist')) {
    console.log('[AUTH] Watchlist access denied: Not authenticated');
    return res.status(401).json({ 
      message: 'Authentication error: Please login again to add items to your watchlist',
      code: 'AUTH_REQUIRED_WATCHLIST'
    });
  }
  
  // Generic case for unauthenticated access
  console.log('[AUTH] Access denied: Not authenticated');
  return res.status(401).json({ 
    message: 'Unauthorized: Please login to access this feature',
    code: 'AUTH_REQUIRED' 
  });
}

// Middleware to check if the user has access to the requested watchlist
// with enhanced security validation and logging
export function hasWatchlistAccess(req: Request, res: Response, next: NextFunction) {
  // Skip this check for public endpoints
  if (req.path === '/api/users' || req.path.startsWith('/api/movies')) {
    return next();
  }
  
  // Debug logging for watchlist access checking
  console.log(`[AUTH] Checking watchlist access for ${req.method} ${req.path}`);
  
  // For watchlist specific operations
  if (req.path.includes('/watchlist')) {
    // Double-check authentication (defensive programming)
    if (!req.isAuthenticated()) {
      console.log('[AUTH] Watchlist access denied: Session not authenticated');
      return res.status(401).json({ 
        message: 'Authentication error: Session expired, please login again',
        code: 'SESSION_EXPIRED'
      });
    }
    
    const currentUser = req.user as UserResponse;
    
    // Verify user object integrity
    if (!currentUser || !currentUser.id) {
      console.error('[AUTH] Watchlist access denied: Invalid user object in session');
      
      // Force user to re-authenticate
      req.logout((err) => {
        if (err) console.error('[AUTH] Error during forced logout:', err);
      });
      
      return res.status(401).json({ 
        message: 'Session error: User data corrupted. Please login again',
        code: 'SESSION_CORRUPTED'
      });
    }
    
    console.log(`[AUTH] Watchlist access request by user: ${currentUser.username} (ID: ${currentUser.id})`);
    
    // For POST to /api/watchlist (creating watchlist entry)
    if (req.method === 'POST' && req.path === '/api/watchlist') {
      // For watchlist creation, ensure userId in body matches authenticated user
      if (req.body && 'userId' in req.body) {
        const bodyUserId = parseInt(req.body.userId, 10);
        
        if (bodyUserId !== currentUser.id) {
          console.log(`[AUTH] Watchlist creation denied: User ${currentUser.id} tried to create entry for user ${bodyUserId}`);
          return res.status(403).json({ 
            message: 'Access denied: You can only manage your own watchlist',
            code: 'ACCESS_DENIED_CREATE',
            requestedId: bodyUserId,
            yourId: currentUser.id
          });
        }
        
        console.log(`[AUTH] Watchlist creation allowed for user ${currentUser.id}`);
        return next();
      }
      
      // If userId is missing from body, continue to next middleware
      // The route handler should validate required fields
      return next();
    }
    
    // For paths like /api/watchlist/:userId or /api/watchlist/:id
    if (req.path.startsWith('/api/watchlist/')) {
      // Extract the parameter from the path
      const pathParts = req.path.split('/');
      const pathParam = pathParts[pathParts.length - 1];
      const pathUserId = parseInt(pathParam, 10);
      
      // If it's not a number or empty, it might be a different endpoint format
      if (isNaN(pathUserId) || pathParam === '') {
        console.log(`[AUTH] Skipping user ID check for non-numeric path parameter: ${pathParam}`);
        return next();
      }
      
      // For GET /api/watchlist/:userId - verify user has access to this watchlist
      if (req.method === 'GET') {
        // Check if user is accessing their own watchlist
        if (currentUser.id === pathUserId) {
          console.log(`[AUTH] Watchlist access allowed: User ${currentUser.id} accessing own watchlist`);
          return next();
        }
        
        console.log(`[AUTH] Watchlist access denied: User ${currentUser.id} tried to access watchlist ${pathUserId}`);
        // For this application, users can only access their own watchlists
        return res.status(403).json({ 
          message: 'Access denied: You can only access your own watchlist',
          code: 'ACCESS_DENIED_VIEW',
          requestedId: pathUserId,
          yourId: currentUser.id
        });
      }
      
      // For PUT, DELETE operations on /api/watchlist/:id
      // We need to verify the entry belongs to the current user
      if ((req.method === 'PUT' || req.method === 'DELETE') && pathParam) {
        // We'll let the route handler verify ownership before updating/deleting
        // This requires custom logic in the route handler to check the entry's userId
        console.log(`[AUTH] Delegating ownership check for ${req.method} operation to route handler`);
        return next();
      }
    }
    
    // For any other watchlist operations, let the route handler handle it
    console.log('[AUTH] Allowing request to proceed to route handler');
    return next();
  }
  
  // For non-watchlist endpoints
  next();
}