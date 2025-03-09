import jwt from 'jsonwebtoken';
import { Router, Request, Response } from 'express';
import { User, UserResponse } from '@shared/schema';
import { storage } from './storage';
import { JWT_SECRET, TOKEN_EXPIRATION, verifyToken, createUserResponse } from './jwtAuth';

// Create router
const router = Router();

// Helper functions
function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return null;
}

// Routes - using the same JWT_SECRET as the main implementation for consistency
router.get('/simple-jwt/user', (req: Request, res: Response) => {
  try {
    const token = extractTokenFromHeader(req);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    return res.json(payload);
  } catch (error) {
    console.error('[SIMPLE-JWT] Error in /user endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Emergency token functionality has been removed for simplification

export const simpleJwtRouter = router;