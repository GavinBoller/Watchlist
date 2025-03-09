import express, { Request, Response, Router } from 'express';
import { UserResponse } from '@shared/schema';
import { generateToken, verifyToken, JWT_SECRET } from './jwtAuth';

const router = Router();

/**
 * JWT Token Refresh Endpoint
 * This endpoint allows clients to refresh their JWT token before it expires.
 * The token is verified, and if valid (even if close to expiring), a new token is issued.
 */
router.post('/jwt/refresh', async (req: Request, res: Response) => {
  console.log('[TOKEN REFRESH] Token refresh requested');
  
  try {
    // Extract the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    // Extract the token
    const token = authHeader.substring(7);
    
    // Verify the token
    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    console.log(`[TOKEN REFRESH] Valid token for user: ${decoded.username} (ID: ${decoded.id})`);
    
    // Generate a new token
    const newToken = generateToken(decoded);
    
    // Return the new token
    return res.status(200).json({ 
      token: newToken,
      user: decoded
    });
  } catch (error) {
    console.error('[TOKEN REFRESH] Error refreshing token:', error);
    
    // Special error handling for token verification errors
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    // Generic error response
    return res.status(500).json({ 
      error: 'Failed to refresh token',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export const tokenRefreshRouter = router;