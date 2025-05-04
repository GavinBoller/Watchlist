import express, { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import { storage } from './storage.js';
import { z } from 'zod';
import { User } from '../shared/schema.js';

console.log('[SIMPLE REGISTER MODULE] Loaded');

const router = Router();

// Input validation schemas
const registrationSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  displayName: z.string().min(1).max(100).optional(),
});

const loginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
});

/**
 * Register a new user
 */
router.post('/simple-register', async (req: Request, res: Response) => {
  try {
    const { username, password, displayName } = registrationSchema.parse(req.body);

    const existingUser = await storage.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await storage.createUser({
      username,
      password: hashedPassword,
      displayName: displayName || username,
      environment: process.env.NODE_ENV === 'production' ? 'production' : null,
    });

    return res.status(201).json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt,
        environment: user.environment,
      },
    });
  } catch (error) {
    console.error('[SIMPLE REGISTER] Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid registration data', details: error.errors });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Login a user
 */
router.post('/simple-login', async (req: Request, res: Response) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user: User | undefined = await storage.getUserByUsername(username);
    console.log('[SIMPLE LOGIN] User result:', user); // Debug log
    if (!user || !user.password) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.authenticated = true;
    req.session.userData = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      environment: process.env.NODE_ENV || 'production',
    };

    return res.json({
      status: 'success',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString(),
        environment: process.env.NODE_ENV || 'production',
      },
    });
  } catch (error) {
    console.error('[SIMPLE LOGIN] Error:', error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid login data', details: error.errors });
    }
    return res.status(500).json({ error: 'Server error' });
  }
});

export const authSimpleRegisterRouter = router;