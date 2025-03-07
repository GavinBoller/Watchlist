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
export function isJwtAuthenticated(req: Request, res: Response, next: NextFunction): Response | void {
  console.log(`[JWT AUTH] isJwtAuthenticated check for path: ${req.path}`);
  
  if (req.user) {
    console.log(`[JWT AUTH] User already authenticated via middleware: ${req.user.username} (${req.user.id})`);
    return next();
  }
  
  console.log(`[JWT AUTH] No user in request, checking Authorization header: ${!!req.headers.authorization}`);
  
  // Also check Authorization header for JWT directly
  const token = extractTokenFromHeader(req.headers.authorization);
  if (token) {
    console.log('[JWT AUTH] Token found in Authorization header');
    const userPayload = verifyToken(token);
    if (userPayload) {
      console.log(`[JWT AUTH] Token verified for user: ${userPayload.username} (${userPayload.id})`);
      req.user = userPayload;
      return next();
    } else {
      console.log('[JWT AUTH] Token verification failed');
    }
  } else {
    console.log('[JWT AUTH] No token found in Authorization header');
  }
  
  console.log('[JWT AUTH] Authentication failed, returning 401');
  return res.status(401).json({ error: 'Unauthorized: Authentication required' });
}

/**
 * Middleware to check if user has access to watchlist
 * Similar to the existing hasWatchlistAccess but for JWT
 */
export function hasJwtWatchlistAccess(req: Request, res: Response, next: NextFunction): Response | void {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required' });
  }
  
  const userId = Number(req.params.userId) || Number(req.body.userId);
  if (!userId) {
    return res.status(400).json({ error: 'Bad Request: userId is required' });
  }
  
  // Allow access if the user is accessing their own watchlist
  if (req.user && 'id' in req.user && req.user.id === userId) {
    return next();
  }
  
  return res.status(403).json({ error: 'Forbidden: Cannot access another user\'s watchlist' });
}