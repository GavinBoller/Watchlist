const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { scrypt, timingSafeEqual } = require('crypto');
const { promisify } = require('util');

const app = express();
app.use(express.json());

const scryptAsync = promisify(scrypt);

// Mocked user lookup (replace with database lookup later)
const mockGetUserByUsername = async (username) => {
  // Placeholder: Simulate a user with a bcrypt-hashed password
  if (username === 'testuser') {
    return {
      id: 1,
      username: 'testuser',
      password: '$2a$10$examplehashedpassword1234567890', // Mock bcrypt hash
      displayName: 'Test User',
      createdAt: new Date()
    };
  }
  return null;
};

// Copied from server/jwtAuth.js (inferred implementation)
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret';
const TOKEN_EXPIRATION = '7d';
const createUserResponse = (user) => ({
  userId: user.id,
  username: user.username,
  displayName: user.displayName || user.username,
  createdAt: user.createdAt
});
const generateToken = (userResponse) => {
  return jwt.sign(userResponse, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
};
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('[JWT] Token verification failed:', error);
    return null;
  }
};

// Copied from jwtAuthRoutes.js
async function comparePasswords(supplied, stored) {
  try {
    console.log(`[AUTH] Comparing password for auth. Stored hash format: ${stored.substring(0, 3)}...`);

    // First try using bcrypt for passwords starting with $2a$ or $2b$
    if (stored.startsWith('$2')) {
      const result = await bcrypt.compare(supplied, stored);
      console.log(`[AUTH] Bcrypt comparison result: ${result}`);
      return result;
    }

    // Direct string comparison for testing
    if (supplied === stored) {
      console.log('[AUTH] Direct string comparison match - allowing for testing');
      return true;
    }

    // Fallback to scrypt for custom format passwords
    const [hashed, salt] = stored.split('.');
    if (hashed && salt) {
      const hashedBuf = Buffer.from(hashed, 'hex');
      const suppliedBuf = await scryptAsync(supplied, salt, 64);
      const result = timingSafeEqual(hashedBuf, suppliedBuf);
      console.log(`[AUTH] Scrypt comparison result: ${result}`);
      return result;
    }

    console.error('[AUTH] Unknown password format:', stored.substring(0, 3) + '...');
    return false;
  } catch (error) {
    console.error('[AUTH] Password comparison error:', error);
    return false;
  }
}

app.post('/api/jwt/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Look up the user (mocked for now)
    const user = await mockGetUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    // Verify password
    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    // Generate JWT token
    const userResponse = createUserResponse(user);
    const token = generateToken(userResponse);

    // Verify token immediately
    const verifiedUser = verifyToken(token);
    if (!verifiedUser) {
      console.error(`[JWT AUTH] Generated token failed verification for user ${username}`);
      console.error('[JWT AUTH] Using hardcoded secret for reliability');
      return res.status(500).json({ error: 'JWT token generation failed - please contact support' });
    }

    console.log(`[JWT AUTH] Login successful and token verified for user ${username}`);

    // Send token and user information
    res.status(200).json({
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('[JWT AUTH] Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

module.exports = app;