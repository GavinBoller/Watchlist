const jwtAuth = require('./jwtAuth.js');

import { Request, Response, NextFunction } from 'express';
import { UserResponse } from './shared/types.js';

function isJwtAuthenticated(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }

  try {
    const decoded = jwtAuth.verifyToken(token) as { id: number; username: string };
    req.user = {
      id: decoded.id,
      username: decoded.username,
      displayName: null,
      createdAt: new Date(),
      environment: null,
    };
    next();
  } catch (err) {
    console.error('[JWT_MIDDLEWARE] Error:', err);
    return res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
}

module.exports = { isJwtAuthenticated };