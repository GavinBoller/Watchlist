const express = require('express');
const passport = require('passport');
const bcrypt = require('bcryptjs');
const schema = require('./shared/schema.js');
const db = require('./db.js');
const { eq } = require('drizzle-orm');

import { Request, Response } from 'express';
import { UserResponse } from './shared/types.js';

const authRoutesRouter = express.Router();

// Register route
authRoutesRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ status: 'error', message: 'Username and password are required' });
    }

    const existingUser = await db.db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      username,
      password: hashedPassword,
      displayName: displayName || username,
      createdAt: new Date(),
      environment: process.env.NODE_ENV,
    };

    const insertedUser = await db.db.insert(schema.users).values(newUser).returning();
    const user = insertedUser[0];

    const userResponse: UserResponse = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      environment: user.environment,
    };

    req.login(userResponse, (err: Error) => {
      if (err) {
        console.error('[AUTH] Error during login after registration:', err);
        return res.status(500).json({ status: 'error', message: 'Registration successful, but login failed' });
      }
      res.status(201).json(userResponse);
    });
  } catch (err) {
    console.error('[AUTH] Registration error:', err);
    res.status(500).json({ status: 'error', message: 'Registration failed' });
  }
});

// Login route
authRoutesRouter.post('/login', passport.authenticate('local'), (req: Request, res: Response) => {
  const user = req.user as UserResponse;
  if (!user) {
    return res.status(401).json({ status: 'error', message: 'Authentication failed' });
  }
  if (req.session) {
    req.session.authenticated = true;
    req.session.userData = user; // Should match UserResponse
    req.session.preservedUserId = user.id;
    req.session.preservedUsername = user.username;
    req.session.preservedDisplayName = user.displayName;
    req.session.save((err: Error) => {
      if (err) {
        console.error('[AUTH] Error saving session after login:', err);
      }
    });
  }
  res.status(200).json(user);
});

// Logout route
authRoutesRouter.post('/logout', (req: Request, res: Response) => {
  if (req.session) {
    console.log(`[AUTH] Logging out user: ${req.session.preservedUsername || 'unknown'}`);
    req.logout((err: Error) => {
      if (err) {
        console.error('[AUTH] Error during logout:', err);
        return res.status(500).json({ status: 'error', message: 'Logout failed' });
      }
      req.session.destroy((err: Error) => {
        if (err) {
          console.error('[AUTH] Error destroying session:', err);
          return res.status(500).json({ status: 'error', message: 'Session destruction failed' });
        }
        res.status(200).json({ status: 'success', message: 'Logged out successfully' });
      });
    });
  } else {
    res.status(200).json({ status: 'success', message: 'No active session to log out' });
  }
});

module.exports = authRoutesRouter;