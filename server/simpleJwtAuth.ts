import jwt from 'jsonwebtoken';
import { Router, Request, Response } from 'express';
import { User, UserResponse } from '@shared/schema';
import { storage } from './storage';

// Using a very simple JWT implementation with hard-coded secret
// This is meant as a fallback solution when the main JWT system has issues
const SIMPLE_JWT_SECRET = 'super-simple-jwt-secret-key-for-replit-watchlist-app-2023';
const SIMPLE_TOKEN_EXPIRATION = '7d';

// Create router
const router = Router();

// Helper functions
function generateSimpleToken(payload: any): string {
  return jwt.sign(payload, SIMPLE_JWT_SECRET, { expiresIn: SIMPLE_TOKEN_EXPIRATION });
}

function verifySimpleToken(token: string): any | null {
  try {
    return jwt.verify(token, SIMPLE_JWT_SECRET);
  } catch (error) {
    console.error('[SIMPLE-JWT] Token verification failed:', error);
    return null;
  }
}

function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  return null;
}

// Create safe user response without password
function createSafeUserResponse(user: User): UserResponse {
  const { password, ...userResponse } = user;
  return userResponse;
}

// Routes
router.get('/simple-jwt/user', (req: Request, res: Response) => {
  try {
    const token = extractTokenFromHeader(req);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const payload = verifySimpleToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    return res.json(payload);
  } catch (error) {
    console.error('[SIMPLE-JWT] Error in /user endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Login endpoint - simply accepts username and returns a token
router.post('/simple-jwt/login', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }
    
    // Get user from storage
    const user = await storage.getUserByUsername(username);
    if (!user) {
      console.log('[SIMPLE-JWT] Creating Test82 user for simplified login');
      
      // If user doesn't exist, create Test82 user
      const newUser = await storage.createUser({
        username: 'Test82',
        password: 'password123', // Simple password for testing
        displayName: 'Test User 82'
      });
      
      const userResponse = createSafeUserResponse(newUser);
      const token = generateSimpleToken(userResponse);
      
      return res.json({ token, user: userResponse });
    }
    
    // Generate token
    const userResponse = createSafeUserResponse(user);
    const token = generateSimpleToken(userResponse);
    
    return res.json({ token, user: userResponse });
  } catch (error) {
    console.error('[SIMPLE-JWT] Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
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
        password: 'password123', // Simple password for testing
        displayName: 'Test User 82'
      });
    }
    
    // Generate token with user information
    const userResponse = createSafeUserResponse(user);
    const token = generateSimpleToken(userResponse);
    
    // Verify token immediately
    const verified = verifySimpleToken(token);
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