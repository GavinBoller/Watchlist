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

// Generate emergency token endpoint
router.get('/simple-jwt/emergency-token', async (req: Request, res: Response) => {
  try {
    console.log('[SIMPLE-JWT] Generating emergency token for Test82');
    
    // Get Test82 user
    let user = await storage.getUserByUsername('Test82');
    
    // Create user if it doesn't exist
    if (!user) {
      console.log('[SIMPLE-JWT] Creating Test82 user for emergency token');
      user = await storage.createUser({
        username: 'Test82',
        password: 'test82', // Simple password for testing
        displayName: 'Test82'
      });
    }
    
    // Generate token with user information
    const userResponse = createUserResponse(user);
    const token = jwt.sign(userResponse, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
    
    // Verify token immediately
    const verified = verifyToken(token);
    if (!verified) {
      console.error('[SIMPLE-JWT] Emergency token failed verification');
      return res.status(500).json({ error: 'Token generation failed' });
    }
    
    console.log('[SIMPLE-JWT] Emergency token generated successfully');
    return res.json({ 
      token, 
      user: userResponse,
      message: 'Emergency token generated successfully'
    });
  } catch (error) {
    console.error('[SIMPLE-JWT] Emergency token error:', error);
    return res.status(500).json({ error: 'Failed to generate emergency token' });
  }
});

export const simpleJwtRouter = router;