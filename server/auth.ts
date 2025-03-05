import { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcryptjs';
import { User, UserResponse } from '@shared/schema';
import { storage } from './storage';

// Configure Passport with Local Strategy
export function configurePassport() {
  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        
        if (!user) {
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
          return done(null, false, { message: 'Incorrect username or password' });
        }
        
        // Return user without password
        const { password: _, ...userWithoutPassword } = user;
        return done(null, userWithoutPassword);
      } catch (error) {
        return done(error);
      }
    })
  );
  
  // User serialization for session
  passport.serializeUser((user, done) => {
    done(null, (user as UserResponse).id);
  });
  
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      
      if (!user) {
        return done(null, false);
      }
      
      // Return user without password
      const { password: _, ...userWithoutPassword } = user;
      done(null, userWithoutPassword);
    } catch (error) {
      done(error);
    }
  });
}

// Middleware to check if user is authenticated
export function isAuthenticated(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  
  // Provide a more descriptive error message for client-side handling
  if (req.path.includes('/watchlist')) {
    return res.status(401).json({ 
      message: 'Authentication error: Please login again to add items to your watchlist',
      code: 'AUTH_REQUIRED_WATCHLIST'
    });
  }
  
  res.status(401).json({ 
    message: 'Unauthorized: Please login to access this feature',
    code: 'AUTH_REQUIRED' 
  });
}

// Middleware to check if the user has access to the requested watchlist
export function hasWatchlistAccess(req: Request, res: Response, next: NextFunction) {
  // Skip this check for public endpoints
  if (req.path === '/api/users' || req.path.startsWith('/api/movies')) {
    return next();
  }
  
  // For watchlist specific operations
  if (req.path.startsWith('/api/watchlist/')) {
    const currentUser = req.user as UserResponse;
    
    if (!currentUser) {
      return res.status(401).json({ 
        message: 'Authentication error: Session expired, please login again',
        code: 'SESSION_EXPIRED'
      });
    }
    
    // Extract the userId from the path
    const pathParts = req.path.split('/');
    const pathUserId = parseInt(pathParts[pathParts.length - 1], 10);
    
    // If it's not a number, it might be a different endpoint format
    if (isNaN(pathUserId)) {
      return next();
    }
    
    // Check if user is accessing their own watchlist
    if (currentUser.id === pathUserId) {
      return next();
    }
    
    // For this application, users can only access their own watchlists
    return res.status(403).json({ 
      message: 'Access denied: You can only access your own watchlist',
      code: 'ACCESS_DENIED',
      requestedId: pathUserId,
      yourId: currentUser.id
    });
  } else {
    // For other endpoints
    next();
  }
}