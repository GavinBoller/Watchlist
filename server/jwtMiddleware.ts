import { Request, Response, NextFunction } from 'express';
import { extractTokenFromHeader, verifyToken } from './jwtAuth';
import { User, UserResponse } from '@shared/schema';
import { storage } from './storage';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface User extends UserResponse {}
  }
}

/**
 * JWT Authentication middleware
 * 
 * This middleware checks for a valid JWT token in the Authorization header
 * and attaches the user to the request object if authenticated
 */
export async function jwtAuthenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check for token in Authorization header
  const token = extractTokenFromHeader(req.headers.authorization);
  
  // Log token info (without showing the actual token)
  console.log(`[JWT AUTH] Request path: ${req.path}, Authorization header present: ${!!req.headers.authorization}`);
  
  // If no token is provided, continue without authentication
  if (!token) {
    console.log('[JWT AUTH] No token provided');
    return next();
  }
  
  // Verify the token
  const userPayload = verifyToken(token);
  if (!userPayload) {
    console.log('[JWT AUTH] Token verification failed');
    return next();
  }
  
  console.log(`[JWT AUTH] Token verified successfully for user: ${userPayload.username} (ID: ${userPayload.id})`);
  
  // Get the full user from storage if needed (optional)
  // This step can be skipped if the JWT payload contains all needed user data
  try {
    const user = await storage.getUser(userPayload.id);
    if (user) {
      // Attach user to request (omit password)
      const { password, ...userWithoutPassword } = user;
      req.user = userWithoutPassword as User;
    }
  } catch (error) {
    console.error('[JWT AUTH] Error fetching user:', error);
    // Continue even if user fetch fails, with just the JWT payload
    req.user = userPayload;
  }
  
  next();
}

/**
 * Middleware to check if user is authenticated via JWT
 * This is an alternative to the passport isAuthenticated middleware
 */
export async function isJwtAuthenticated(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  console.log(`[JWT AUTH] isJwtAuthenticated check for path: ${req.path}`);
  console.log(`[JWT AUTH] Request method: ${req.method}`);
  console.log(`[JWT AUTH] Authorization header: ${req.headers.authorization ? 'Present' : 'Missing'}`);
  console.log(`[JWT AUTH] Content-Type: ${req.headers['content-type'] || 'Not set'}`);
  
  if (req.user) {
    console.log(`[JWT AUTH] User already authenticated via middleware: ${req.user.username} (${req.user.id})`);
    return next();
  }
  
  // Also check Authorization header for JWT directly
  const authHeader = req.headers.authorization;
  console.log('[JWT AUTH] Authorization header:', authHeader ? `${authHeader.substring(0, 10)}...` : 'None');
  
  const token = extractTokenFromHeader(authHeader);
  if (token) {
    console.log(`[JWT AUTH] Token found in Authorization header (first 20 chars): ${token.substring(0, 20)}...`);
    const userPayload = verifyToken(token);
    if (userPayload) {
      console.log(`[JWT AUTH] Token verified for user: ${userPayload.username} (${userPayload.id})`);
      req.user = userPayload;
      
      // Load full user data from storage for extra information
      try {
        const user = await storage.getUser(userPayload.id);
        if (user) {
          console.log(`[JWT AUTH] Found full user data for ${user.username} (${user.id})`);
          // Attach user to request (omit password)
          const { password, ...userWithoutPassword } = user;
          req.user = userWithoutPassword as UserResponse;
        }
      } catch (error) {
        console.error('[JWT AUTH] Error fetching user data, using token payload:', error);
        // Continue with just the token payload if storage lookup fails
      }
      
      return next();
    } else {
      console.log('[JWT AUTH] Token verification failed');
    }
  } else {
    // Check if this is a potential CORS preflight request
    if (req.method === 'OPTIONS') {
      console.log('[JWT AUTH] OPTIONS request - potential CORS preflight, allowing');
      return next();
    }
    
    console.log('[JWT AUTH] No token found in Authorization header');
    
    // Enhanced logging for debugging - check headers
    console.log('[JWT AUTH] Available headers:', Object.keys(req.headers).join(', '));
    
    // Try to extract token from cookie as fallback
    const cookies = req.headers.cookie;
    if (cookies && cookies.includes('jwt_token=')) {
      console.log('[JWT AUTH] Found potential JWT token in cookies, attempting extraction');
      try {
        const match = cookies.match(/jwt_token=([^;]+)/);
        if (match && match[1]) {
          const cookieToken = match[1];
          console.log('[JWT AUTH] Extracted token from cookie (first 10 chars):', cookieToken.substring(0, 10));
          
          const cookieUserPayload = verifyToken(cookieToken);
          if (cookieUserPayload) {
            console.log(`[JWT AUTH] Cookie token verified for user: ${cookieUserPayload.username} (${cookieUserPayload.id})`);
            req.user = cookieUserPayload;
            return next();
          }
        }
      } catch (error) {
        console.error('[JWT AUTH] Error processing cookie token:', error);
      }
    }
    
    if (req.headers['x-user-id'] && req.headers['x-username']) {
      console.log(`[JWT AUTH] Found backup user info in headers: User ID=${req.headers['x-user-id']}, Username=${req.headers['x-username']}`);
      
      // We've disabled emergency recovery for security reasons
      // but we log the information for diagnostic purposes
    }
  }
  
  console.log('[JWT AUTH] Authentication failed, returning 401');
  return res.status(401).json({ 
    error: 'Unauthorized: Authentication required',
    message: 'Please log in again. Your session may have expired.',
    path: req.path,
    method: req.method 
  });
}

/**
 * Middleware to check if user has access to watchlist
 * Similar to the existing hasWatchlistAccess but for JWT
 */
export async function hasJwtWatchlistAccess(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  
  // Check all possible locations for userId
  const userId = Number(req.params.userId) || 
                Number(req.body.userId) || 
                Number(req.query.userId) || 
                (req.headers['x-user-id'] ? Number(req.headers['x-user-id']) : null);
                
  if (!userId) {
    console.log('[JWT AUTH] Missing userId in request for hasJwtWatchlistAccess');
    console.log('[JWT AUTH] Request path:', req.path);
    console.log('[JWT AUTH] Request method:', req.method);
    console.log('[JWT AUTH] Request params:', req.params);
    console.log('[JWT AUTH] Request query:', req.query);
    console.log('[JWT AUTH] Request headers:', req.headers['x-user-id'] || 'Not provided');
    return res.status(400).json({ error: 'Bad Request: userId is required' });
  }
  
  // Allow access if the user is accessing their own watchlist
  if (req.user && 'id' in req.user && req.user.id === userId) {
    return next();
  }
  
  return res.status(403).json({ error: 'Forbidden: Cannot access another user\'s watchlist' });
}