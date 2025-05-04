import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { storage } from './storage.js';
import { UserResponse } from '../shared/schema.js';

export function isJwtAuthenticated(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as { id: number; username: string };
    storage.getUser(decoded.id).then((user: UserResponse | undefined) => {
      if (!user) {
        return res.status(401).json({ status: 'error', message: 'Invalid token' });
      }
      req.user = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt,
        environment: user.environment,
      } as UserResponse;
      next();
    }).catch((err: Error) => {
      console.error('[JWT] Error verifying user:', err);
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    });
  } catch (err) {
    console.error('[JWT] Token verification failed:', err);
    return res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
}