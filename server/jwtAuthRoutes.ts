const express = require('express');
const jwtAuth = require('./jwtAuth.js');

import { Request, Response } from 'express';

type UserResponse = {
  id: number;
  username: string;
  displayName: string | null;
  createdAt: Date;
  environment: string | null;
};

const jwtAuthRoutesRouter = express.Router();

jwtAuthRoutesRouter.post('/jwt-login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const result = await jwtAuth.authenticateJWT(username, password);
    if (!result) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }
    res.status(200).json({ user: result.user as UserResponse, token: result.token });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Login failed' });
  }
});

module.exports = jwtAuthRoutesRouter;