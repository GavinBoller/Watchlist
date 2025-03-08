import { Router, Request, Response } from 'express';
import { db, pool } from './db';
import { insertUserSchema, users } from '@shared/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { generateToken, createUserResponse } from './jwtAuth';
import { executeDirectSql } from './db';

// Environment detection
const isProd = process.env.NODE_ENV === 'production';

const router = Router();

/**
 * Helper function to hash password securely
 */
async function hashPassword(password: string): Promise<string> {
  // Use bcrypt with 10 rounds (standard for web applications)
  return bcrypt.hash(password, 10);
}

/**
 * Simplified registration endpoint with robust error handling
 * This endpoint creates a new user and returns a JWT token
 */
router.post('/simple-register', async (req: Request, res: Response) => {
  try {
    console.log('[SIMPLE AUTH] Simplified registration attempt for:', req.body.username);
    
    // Validate input with zod schema
    const validationResult = insertUserSchema.safeParse(req.body);
    if (!validationResult.success) {
      console.log('[SIMPLE AUTH] Validation failed:', validationResult.error);
      return res.status(400).json({ 
        error: 'Invalid registration data',
        details: validationResult.error.format()
      });
    }
    
    const { username, password, displayName } = validationResult.data;
    
    // Check if username already exists - using direct SQL for reliability
    try {
      const existing = await executeDirectSql(
        'SELECT id FROM users WHERE username = $1 LIMIT 1',
        [username],
        'Failed to check if username exists'
      );
      
      if (existing && existing.length > 0) {
        console.log('[SIMPLE AUTH] Username already exists:', username);
        return res.status(400).json({ error: 'Username already exists' });
      }
    } catch (error) {
      console.error('[SIMPLE AUTH] Error checking existing username:', error);
      // Continue with registration attempt even if check fails
    }
    
    // Hash password for security
    const hashedPassword = await hashPassword(password);
    console.log('[SIMPLE AUTH] Password hashed successfully');
    
    let newUser;
    
    // Try ORM approach first
    try {
      console.log('[SIMPLE AUTH] Attempting user creation with ORM');
      const [user] = await db
        .insert(users)
        .values({
          username,
          password: hashedPassword,
          displayName: displayName || null
        })
        .returning();
      
      newUser = user;
      console.log('[SIMPLE AUTH] User created successfully with ORM:', username);
    } catch (ormError) {
      console.error('[SIMPLE AUTH] ORM user creation failed:', ormError);
      
      // Fall back to direct SQL
      try {
        console.log('[SIMPLE AUTH] Attempting direct SQL user creation');
        const result = await executeDirectSql(
          'INSERT INTO users (username, password, display_name) VALUES ($1, $2, $3) RETURNING id, username, display_name, created_at',
          [username, hashedPassword, displayName || null],
          'User creation failed'
        );
        
        if (!result || result.length === 0) {
          throw new Error('User creation did not return user data');
        }
        
        newUser = result[0];
        console.log('[SIMPLE AUTH] User created successfully with direct SQL:', username);
      } catch (sqlError) {
        console.error('[SIMPLE AUTH] Direct SQL user creation failed:', sqlError);
        return res.status(500).json({ 
          error: 'Registration failed',
          details: sqlError instanceof Error ? sqlError.message : 'Unknown error'
        });
      }
    }
    
    if (!newUser) {
      console.error('[SIMPLE AUTH] Failed to create user, no error thrown but user not created');
      return res.status(500).json({ error: 'User creation failed with no specific error' });
    }
    
    // Generate JWT token
    try {
      console.log('[SIMPLE AUTH] Generating token for new user:', username);
      const token = generateToken(newUser);
      
      // Send token and user information
      res.status(201).json({
        token,
        user: createUserResponse(newUser)
      });
    } catch (tokenError) {
      console.error('[SIMPLE AUTH] Token generation failed:', tokenError);
      
      // Return user data even if token generation fails
      res.status(201).json({
        user: createUserResponse(newUser),
        warning: 'Token generation failed, you may need to log in again'
      });
    }
  } catch (error) {
    console.error('[SIMPLE AUTH] Unexpected registration error:', error);
    
    // Provide detailed error message for debugging
    res.status(500).json({ 
      error: 'Registration failed due to an unexpected error',
      details: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export const simpleRegisterRouter = router;