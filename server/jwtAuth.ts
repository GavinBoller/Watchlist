const jwtAuthLib = require('jsonwebtoken');
const authSchema = require('./shared/schema.js');
const authStorage = require('./storage.js');
const bcrypt = require('bcryptjs');
import { User, UserResponse } from './shared/types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const TOKEN_EXPIRATION = '1h';

async function authenticateJWT(username: string, password: string) {
  try {
    const user = await authStorage.storage.getUserByUsername(username);
    if (!user || !user.password) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return null;
    }

    const payload = {
      id: user.id,
      username: user.username,
    };
    const token = jwtAuthLib.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

    const userResponse: UserResponse = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      createdAt: user.createdAt,
      environment: user.environment,
    };

    return { user: userResponse, token };
  } catch (err) {
    console.error('[JWT_AUTH] Error:', err);
    throw err;
  }
}

function createUserResponse(user: User): UserResponse {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    environment: user.environment,
  };
}

function verifyToken(token: string) {
  return jwtAuthLib.verify(token, JWT_SECRET);
}

module.exports = { authenticateJWT, JWT_SECRET, TOKEN_EXPIRATION, createUserResponse, verifyToken };