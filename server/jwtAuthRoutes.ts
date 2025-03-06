import { Router, Request, Response } from 'express';
import { generateToken, createUserResponse } from './jwtAuth';
import { storage } from './storage';
import { insertUserSchema } from '@shared/schema';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const router = Router();
const scryptAsync = promisify(scrypt);

/**
 * Helper function to hash password
 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString('hex')}.${salt}`;
}

/**
 * Helper function to compare password with hashed password
 */
async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split('.');
  const hashedBuf = Buffer.from(hashed, 'hex');
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
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