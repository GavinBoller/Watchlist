import { Router, Request, Response } from 'express';
import { generateToken, createUserResponse, verifyToken } from './jwtAuth';
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
    const userResponse = createUserResponse(user);
    const token = generateToken(userResponse);
    
    // Verify token immediately to ensure it works
    const verifiedUser = verifyToken(token);
    if (!verifiedUser) {
      console.error(`[JWT AUTH] Generated token failed verification for user ${username}`);
      console.error('[JWT AUTH] This is a critical security issue - using hardcoded secret for reliability');
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

/**
 * JWT Register endpoint with enhanced error handling and reliability
 */
router.post('/jwt/register', async (req: Request, res: Response) => {
  console.log(`[JWT AUTH] Registration attempt for username: ${req.body?.username || 'unknown'}`);
  
  // Log important information to help diagnose production issues
  console.log(`[JWT AUTH] Client IP: ${req.ip}`);
  console.log(`[JWT AUTH] Environment: ${process.env.NODE_ENV || 'development'}`);
  
  try {
    // Validate input with zod schema
    const result = insertUserSchema.safeParse(req.body);
    if (!result.success) {
      console.error(`[JWT AUTH] Validation error:`, result.error);
      return res.status(400).json({ 
        error: 'Invalid user data', 
        details: result.error.errors.map(err => ({ path: err.path.join('.'), message: err.message }))
      });
    }
    
    // Extract validated data
    const { username, password, displayName } = result.data;
    
    // Add retry logic for database operations in production
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        // Check if username already exists
        console.log(`[JWT AUTH] Checking if username '${username}' already exists (attempt ${retryCount + 1})`);
        const existingUser = await storage.getUserByUsername(username);
        if (existingUser) {
          console.log(`[JWT AUTH] User '${username}' already exists`);
          return res.status(400).json({ 
            error: 'Username already exists',
            code: 'DUPLICATE_USERNAME'
          });
        }
        
        // Hash password
        console.log('[JWT AUTH] Hashing password');
        const hashedPassword = await hashPassword(password);
        
        // Prepare user data
        const userData = {
          username,
          password: hashedPassword,
          displayName: displayName || username
        };
        
        // Create user with retry handling
        console.log(`[JWT AUTH] Creating user '${username}' (attempt ${retryCount + 1})`);
        const newUser = await storage.createUser(userData);
        console.log(`[JWT AUTH] User '${username}' created successfully`);
        
        // Generate JWT token
        console.log('[JWT AUTH] Generating and verifying JWT token');
        const userResponse = createUserResponse(newUser);
        const token = generateToken(userResponse);
        
        // Verify token immediately to ensure it works
        const verifiedUser = verifyToken(token);
        if (!verifiedUser) {
          console.error(`[JWT AUTH] Generated token failed verification for new user ${username}`);
          console.error('[JWT AUTH] This is a critical security issue - using hardcoded secret for reliability');
          return res.status(500).json({ 
            error: 'Authentication token generation failed',
            code: 'TOKEN_GENERATION_FAILED'
          });
        }
        
        console.log(`[JWT AUTH] Registration successful and token verified for user ${username}`);
        
        // Send token and user information
        return res.status(201).json({
          token,
          user: userResponse
        });
      } catch (dbError) {
        retryCount++;
        
        // Log detailed error information
        console.error(`[JWT AUTH] Database operation failed (attempt ${retryCount}/${maxRetries + 1}):`, dbError);
        
        if (dbError instanceof Error) {
          const errorMessage = dbError.message || 'Unknown database error';
          
          // Check for duplicate key error
          if (errorMessage.includes('duplicate key') || 
              errorMessage.includes('unique constraint') ||
              errorMessage.includes('already exists')) {
            
            console.log(`[JWT AUTH] Detected duplicate key error for '${username}'`);
            return res.status(409).json({ 
              error: 'Username already exists',
              code: 'DUPLICATE_USERNAME'
            });
          }
          
          // Check for connection errors
          if (errorMessage.includes('connection') || 
              errorMessage.includes('timeout') ||
              errorMessage.includes('ECONNREFUSED')) {
            
            console.log(`[JWT AUTH] Database connection issue detected on attempt ${retryCount}`);
            
            // Retry if we haven't exceeded max retries
            if (retryCount <= maxRetries) {
              const delayMs = 500 * Math.pow(2, retryCount - 1); // Exponential backoff
              console.log(`[JWT AUTH] Will retry in ${delayMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
              continue;
            }
          }
        }
        
        // If we've used all retries or it's not a retryable error, throw to outer catch
        if (retryCount > maxRetries) {
          console.error(`[JWT AUTH] All ${maxRetries + 1} attempts failed, giving up.`);
          throw dbError;
        }
      }
    }
    
    // This should never be reached due to the while loop structure
    throw new Error('Registration failed after all retries');
    
  } catch (error) {
    console.error('[JWT AUTH] Registration error:', error);
    
    // Provide more specific error messages based on the type of error
    if (error instanceof Error) {
      console.error('[JWT AUTH] Error name:', error.name);
      console.error('[JWT AUTH] Error message:', error.message);
      
      const errorMessage = error.message;
      
      if (errorMessage.includes('duplicate key') || 
          errorMessage.includes('unique constraint') ||
          errorMessage.includes('already exists')) {
        return res.status(409).json({ 
          error: 'Username already exists',
          code: 'DUPLICATE_USERNAME'
        });
      } else if (errorMessage.includes('connection') || 
                errorMessage.includes('timeout') ||
                errorMessage.includes('ECONNREFUSED')) {
        return res.status(503).json({ 
          error: 'Registration service temporarily unavailable, please try again in a moment',
          code: 'SERVICE_UNAVAILABLE',
          retryAfter: 3
        });
      }
    }
    
    // Generic error with detailed information
    res.status(500).json({ 
      error: 'Server error during registration - try again in a moment',
      code: 'REGISTRATION_FAILED',
      retryAfter: 5
    });
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
  try {
    // Get token from Authorization header or request body
    const authHeader = req.headers.authorization;
    const tokenFromBody = req.body.token;
    
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (tokenFromBody) {
      token = tokenFromBody;
    }
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }
    
    // Manually verify the token
    const verified = verifyToken(token);
    if (!verified) {
      console.error('[JWT] Token validation failed on direct validation endpoint');
      return res.status(401).json({ valid: false, error: 'Invalid token' });
    }
    
    console.log('[JWT] Token successfully validated:', verified.username);
    return res.status(200).json({ valid: true, user: verified });
  } catch (error) {
    console.error('[JWT] Token validation error:', error);
    return res.status(500).json({ valid: false, error: 'Token validation error' });
  }
});

// Emergency token generator has been removed to simplify authentication

export const jwtAuthRouter = router;