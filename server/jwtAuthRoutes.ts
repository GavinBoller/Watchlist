import { Router, Request, Response } from 'express';
import { generateToken, createUserResponse } from './jwtAuth';
import { storage } from './storage';
import { insertUserSchema } from '@shared/schema';
import bcrypt from 'bcryptjs';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const router = Router();
const scryptAsync = promisify(scrypt);

/**
 * Helper function to hash password
 */
async function hashPassword(password: string): Promise<string> {
  // Use bcrypt with 10 rounds for compatibility with existing passwords
  return bcrypt.hash(password, 10);
}

/**
 * Helper function to compare password with hashed password
 */
async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  // Use bcrypt to compare passwords - handles both bcrypt and our custom format
  try {
    // First try using bcrypt for passwords starting with $2a$ or $2b$ (bcrypt format)
    if (stored.startsWith('$2')) {
      return await bcrypt.compare(supplied, stored);
    }
    
    // Fallback to scrypt for custom format passwords (if any exist)
    const [hashed, salt] = stored.split('.');
    if (hashed && salt) {
      const hashedBuf = Buffer.from(hashed, 'hex');
      const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
      return timingSafeEqual(hashedBuf, suppliedBuf);
    }
    
    // If we can't determine the format, fail securely
    console.error('[AUTH] Unknown password format:', stored.substring(0, 3) + '...');
    return false;
  } catch (error) {
    console.error('[AUTH] Password comparison error:', error);
    return false;
  }
}

/**
 * JWT Login endpoint
 */
router.post('/jwt/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // First try standard login
    const user = await storage.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    
    // Verify password
    const passwordMatch = await comparePasswords(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    
    // Generate JWT token
    const token = generateToken(user);
    const userResponse = createUserResponse(user);
    
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

/**
 * JWT Register endpoint
 */
router.post('/jwt/register', async (req: Request, res: Response) => {
  try {
    // Validate input with zod schema
    const result = insertUserSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Invalid user data', details: result.error });
    }
    
    // Check if username already exists
    const existingUser = await storage.getUserByUsername(req.body.username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash password and create user
    const userData = {
      ...req.body,
      password: await hashPassword(req.body.password)
    };
    
    const newUser = await storage.createUser(userData);
    
    // Generate JWT token
    const token = generateToken(newUser);
    const userResponse = createUserResponse(newUser);
    
    // Send token and user information
    res.status(201).json({
      token,
      user: userResponse
    });
  } catch (error) {
    console.error('[JWT AUTH] Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * Get current user info from JWT
 */
router.get('/jwt/user', async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  res.status(200).json(req.user);
});

/**
 * Validate token endpoint (optional, for debugging)
 */
router.post('/jwt/validate', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  res.status(200).json({ valid: true, user: req.user });
});

export const jwtAuthRouter = router;