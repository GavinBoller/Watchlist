import { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { scrypt, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { storage } from './storage.js';
import { User } from '../shared/schema.js';

const router = Router();
const scryptAsync = promisify(scrypt);

// Simple login schema for validation
const simpleLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

interface UserPayload {
  id: number;
  username: string;
  displayName: string | null;
  createdAt: Date | null;
  environment: string | null;
}

function createUserResponse(user: User): UserPayload {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    environment: user.environment,
  };
}

function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
    },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '1h' }
  );
}

/**
 * Simplified login endpoint with robust error handling
 * This provides a streamlined, reliable login process with JWT token generation
 */
router.post('/jwt-login', async (req: Request, res: Response) => {
  console.log('[SIMPLE LOGIN] Beginning login request');

  try {
    // Validate the request body
    const validationResult = simpleLoginSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid login data',
        details: validationResult.error.errors,
      });
    }

    const { username, password } = validationResult.data;
    console.log(`[SIMPLE LOGIN] Attempting login for user: ${username}`);

    // Look up the user
    const user: User | undefined = await storage.getUserByUsername(username);
    if (!user || !user.password) {
      console.log(`[SIMPLE LOGIN] User not found or password missing: ${username}`);
      return res.status(401).json({
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Compare passwords
    let passwordMatch = false;

    // First try with bcrypt (for bcrypt-hashed passwords)
    if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
      try {
        passwordMatch = await bcrypt.compare(password, user.password);
      } catch (bcryptError) {
        console.error('[SIMPLE LOGIN] Bcrypt comparison error:', bcryptError);
      }
    }

    // If bcrypt didn't work, try the crypto-based comparison (for custom format)
    if (!passwordMatch && user.password.includes('.')) {
      try {
        const [hashedPassword, salt] = user.password.split('.');
        const keyBuffer = (await scryptAsync(password, salt, 64)) as Buffer;
        const storedBuffer = Buffer.from(hashedPassword, 'hex');

        if (keyBuffer.length === storedBuffer.length) {
          passwordMatch = timingSafeEqual(keyBuffer, storedBuffer);
        }
      } catch (cryptoError) {
        console.error('[SIMPLE LOGIN] Crypto comparison error:', cryptoError);
      }
    }

    // Handle failed password match
    if (!passwordMatch) {
      console.log(`[SIMPLE LOGIN] Password mismatch for user: ${username}`);
      return res.status(401).json({
        error: 'Invalid username or password',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // Generate JWT token
    console.log(`[SIMPLE LOGIN] Generating token for user: ${username}`);
    const userResponse = createUserResponse(user);
    const token = generateToken(userResponse);

    // Return success with token and user data
    console.log(`[SIMPLE LOGIN] Login successful for user: ${username}`);
    return res.status(200).json({
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error('[SIMPLE LOGIN] Error during login:', error);

    // Enhanced error reporting
    let errorMessage = 'Login failed due to an internal error';
    let statusCode = 500;
    let errorCode = 'LOGIN_FAILED';

    if (error instanceof Error) {
      console.error('[SIMPLE LOGIN] Error name:', error.name);
      console.error('[SIMPLE LOGIN] Error message:', error.message);

      // Detect specific error types
      if (error.message.includes('connection') || error.message.includes('timeout')) {
        errorMessage = 'Database connection issue, please try again';
        statusCode = 503;
        errorCode = 'SERVICE_UNAVAILABLE';
      }
    }

    return res.status(statusCode).json({
      error: errorMessage,
      code: errorCode,
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Special direct login endpoint for emergency situations
 * This endpoint bypasses password verification for debugging/recovery
 */
router.get('/direct-login/:username', async (req: Request, res: Response) => {
  try {
    const { username } = req.params;
    console.log(`[DIRECT LOGIN] Attempting direct login for user: ${username}`);

    // Look up the user
    const user: User | undefined = await storage.getUserByUsername(username);
    if (!user) {
      // If user doesn't exist, create a temporary one
      console.log(`[DIRECT LOGIN] User not found, creating temporary user: ${username}`);
      const tempUser: UserPayload = {
        id: -1,
        username,
        displayName: username,
        createdAt: new Date(),
        environment: 'development',
      };

      const token = generateToken(tempUser);
      return res.status(200).json({
        token,
        user: tempUser,
        temporary: true,
      });
    }

    // Generate token for existing user
    console.log(`[DIRECT LOGIN] Generating token for user: ${username}`);
    const userResponse = createUserResponse(user);
    const token = generateToken(userResponse);

    return res.status(200).json({
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error('[DIRECT LOGIN] Error during direct login:', error);
    return res.status(500).json({
      error: 'Direct login failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export const simpleLoginRouter = router;