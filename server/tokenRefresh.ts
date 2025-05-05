const express = require('express');
const jwtTokenLib = require('jsonwebtoken');
const jwtAuth = require('./jwtAuth.js');
const { UserResponse } = require('./shared/types.js');

import { Request, Response } from 'express';

console.log('[TOKEN_REFRESH] Initializing module...');
console.log('[TOKEN_REFRESH] jwtTokenLib:', !!jwtTokenLib);
console.log('[TOKEN_REFRESH] jwtAuth:', !!jwtAuth);

function refreshToken(user: { id: number; username: string }) {
  console.log('[TOKEN_REFRESH] refreshToken called with user:', user);
  const payload = {
    id: user.id,
    username: user.username,
  };
  return jwtTokenLib.sign(payload, jwtAuth.JWT_SECRET, { expiresIn: jwtAuth.TOKEN_EXPIRATION });
}

const tokenRefreshRouter = express.Router();

tokenRefreshRouter.post('/refresh', async (req: Request, res: Response) => {
  console.log('[TOKEN_REFRESH] POST /refresh received:', req.body);
  const { token } = req.body as { token?: string };
  if (!token) {
    return res.status(401).json({ status: 'error', message: 'No token provided' });
  }
  try {
    const decoded = jwtAuth.verifyToken(token) as { id: number; username: string };
    console.log('[TOKEN_REFRESH] Decoded token:', decoded);
    const newToken = refreshToken(decoded);
    res.json({ status: 'success', token: newToken });
  } catch (error) {
    console.error('[TOKEN_REFRESH] Error:', error);
    res.status(401).json({ status: 'error', message: 'Invalid token' });
  }
});

console.log('[TOKEN_REFRESH] Exporting:', { refreshToken, tokenRefreshRouter });

module.exports = { refreshToken, tokenRefreshRouter };