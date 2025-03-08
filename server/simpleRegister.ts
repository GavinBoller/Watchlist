import express, { Request, Response, Router } from 'express';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { insertUserSchema, User } from '@shared/schema';
import { storage } from './storage';
import { generateToken, createUserResponse } from './jwtAuth';
import { z } from 'zod';

const router = Router();
const scryptAsync = promisify(scrypt);

/**
 * Helper function to hash password securely
 */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString('hex')}.${salt}`;
}

// Define the simplified registration input validation schema
const simpleRegistrationSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
  displayName: z.string().min(1).max(100).optional(),
});

/**
 * Simplified registration endpoint with robust error handling
 * This endpoint creates a new user and returns a JWT token
 * 
 * This is a production-safe implementation that works alongside the existing system
 * It provides a more direct path to user creation with better error reporting
 */
router.post('/simple-register', async (req: Request, res: Response) => {
  console.log('[SIMPLE REGISTER] Beginning registration request');
  
  try {
    // Validate input data
    const validationResult = simpleRegistrationSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      console.error('[SIMPLE REGISTER] Validation error:', validationResult.error);
      return res.status(400).json({ 
        error: 'Invalid registration data', 
        details: validationResult.error.errors 
      });
    }
    
    const { username, password, displayName } = validationResult.data;
    
    // Check if username already exists
    console.log(`[SIMPLE REGISTER] Checking if username '${username}' already exists`);
    const existingUser = await storage.getUserByUsername(username);
    
    if (existingUser) {
      console.error(`[SIMPLE REGISTER] Username '${username}' already exists`);
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    // Hash the password
    console.log('[SIMPLE REGISTER] Hashing password');
    const hashedPassword = await hashPassword(password);
    
    // Create user record
    console.log('[SIMPLE REGISTER] Creating user');
    try {
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
      });
      
      // Generate JWT token
      console.log('[SIMPLE REGISTER] Generating JWT token');
      const userResponse = createUserResponse(user);
      const token = generateToken(userResponse);
      
      // Return success response with token and user data
      console.log('[SIMPLE REGISTER] Registration successful, returning user and token');
      return res.status(201).json({
        user: userResponse,
        token
      });
    } catch (createError) {
      console.error('[SIMPLE REGISTER] Database error during user creation:', createError);
      
      // Provide a helpful error message for different types of errors
      let errorMessage = 'Failed to create user account';
      if (createError instanceof Error) {
        if (createError.message.includes('unique constraint')) {
          errorMessage = 'Username already exists';
        } else if (createError.message.includes('connection')) {
          errorMessage = 'Database connection issue, please try again';
        }
      }
      
      return res.status(500).json({ error: errorMessage });
    }
  } catch (error) {
    console.error('[SIMPLE REGISTER] Unexpected error:', error);
    
    // Fallback error response
    return res.status(500).json({ 
      error: 'An unexpected error occurred during registration',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export const simpleRegisterRouter = router;