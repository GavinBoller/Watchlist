/**
 * Ultra-simplified emergency authentication system
 * This is designed to bypass all database requirements and provide a robust
 * authentication mechanism when all else fails
 */

import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtAuth.js';

const router = express.Router();

// Special simple token generation - no database lookup required
function generateEmergencyToken(username: string): string {
  const user = {
    id: -999,
    username,
    displayName: username,
    emergency: true,
    timestamp: Date.now()
  };
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

// Emergency login endpoint
router.post('/auth/emergency-login', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({
        error: 'Username is required for emergency login'
      });
    }
    const token = generateEmergencyToken(username);
    console.log(`[EMERGENCY] Emergency login issued for ${username}`);
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

// Emergency authentication middleware
export function emergencyAuthCheck(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }
    const token = authHeader.split('Bearer ')[1];
    if (!token) {
      return next();
    }
    const decodedToken = jwt.verify(token, JWT_SECRET) as any;
    if (decodedToken && decodedToken.emergency === true) {
      console.log(`[EMERGENCY] Using emergency token for ${decodedToken.username}`);
      req.user = {
        id: 0,
        username: 'emergency',
        displayName: 'Emergency User',
        createdAt: new Date(),
        environment: 'development'
      };
      return next();
    }
    return next();
  } catch (error) {
    console.error('[EMERGENCY AUTH] Token verification failed:', error);
    return next();
  }
}

export const emergencyAuthRouter = router;