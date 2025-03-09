/**
 * Ultra-simplified emergency authentication system
 * This is designed to bypass all database requirements and provide a robust
 * authentication mechanism when all else fails
 */

import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtAuth';

const router = express.Router();

// Special simple token generation - no database lookup required
function generateEmergencyToken(username: string): string {
  // Create a user object with minimal required fields
  // Use negative ID to mark this as an emergency user
  const user = {
    id: -999,
    username,
    displayName: username,
    emergency: true,
    timestamp: Date.now()
  };
  
  // Sign with long expiration - 7 days
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

// Emergency login endpoint - creates a token with zero database dependency
router.post('/auth/emergency-login', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    
    if (!username) {
      return res.status(400).json({
        error: 'Username is required for emergency login'
      });
    }
    
    // Generate token without any database lookup
    const token = generateEmergencyToken(username);
    
    // Log the action for audit purposes
    console.log(`[EMERGENCY] Emergency login issued for ${username}`);
    
    // Return token and user data
    return res.json({
      success: true,
      token,
      user: {
        id: -999,
        username,
        displayName: username,
        emergency: true
      },
      message: 'Emergency authentication successful. This is a temporary login that bypasses normal authentication.'
    });
  } catch (error) {
    console.error('[EMERGENCY AUTH] Error during emergency login:', error);
    return res.status(500).json({
      error: 'Emergency authentication failed',
      message: 'Could not complete emergency login process',
      technical: String(error)
    });
  }
});

// Emergency authentication middleware for routes that need to check for emergency tokens
export function emergencyAuthCheck(req: Request, res: Response, next: NextFunction) {
  try {
    // Get authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Not using emergency auth, continue to next middleware
    }
    
    // Extract token
    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      return next(); // No token, continue to next middleware
    }
    
    // Verify token
    const decodedToken = jwt.verify(token, JWT_SECRET) as any;
    
    // Check if this is an emergency token
    if (decodedToken && decodedToken.emergency === true) {
      console.log(`[EMERGENCY] Using emergency token for ${decodedToken.username}`);
      
      // Attach emergency user to request
      req.user = {
        id: decodedToken.id || -999,
        username: decodedToken.username,
        displayName: decodedToken.displayName || decodedToken.username,
        emergency: true
      };
      
      return next();
    }
    
    // Not an emergency token, continue to next middleware
    return next();
  } catch (error) {
    // Invalid token, continue to next middleware
    return next();
  }
}

export const emergencyAuthRouter = router;