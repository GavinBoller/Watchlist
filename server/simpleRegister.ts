import express, { Request, Response, Router } from 'express';
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { insertUserSchema, User } from '@shared/schema';
import { storage } from './storage';
import { generateToken, createUserResponse } from './jwtAuth';
import { z } from 'zod';

// Enhanced debugging - log when this module is imported
console.log('[SIMPLE REGISTER MODULE] Loading simple registration module');

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
 * Extracted registration handler function for direct use
 * This allows the same logic to be used by multiple endpoints
 */
export async function simpleRegisterHandler(req: Request, res: Response) {
  console.log('[SIMPLE REGISTER] Beginning registration request');
  
  // Log debug information for production diagnosis
  console.log(`[SIMPLE REGISTER] Request headers: ${JSON.stringify(req.headers)}`);
  console.log(`[SIMPLE REGISTER] Request environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[SIMPLE REGISTER] Request IP: ${req.ip}`);
  
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
      // Extra logging for production troubleshooting
      console.log(`[SIMPLE REGISTER] Attempting to create user with username: ${username}`);
      
      // Use a try-catch with transaction management for better reliability
      let user;
      try {
        // Determine environment based on configuration
      const isProduction = process.env.NODE_ENV === 'production';
      
      // Default environment is 'development' unless we're specifically in production mode
      // or we're registering a known production user
      let userEnvironment = 'development';
      
      // Check for production users - this ensures proper dashboard categorization
      if (isProduction || ['Sophieb', 'Gaju'].includes(username)) {
        userEnvironment = 'production';
      }
      
      // Attempt to create user directly with environment field
      user = await storage.createUser({
          username,
          password: hashedPassword,
          displayName: displayName || username,
          environment: userEnvironment,
        });
        console.log(`[SIMPLE REGISTER] User creation successful: ${username}`);
      } catch (innerError) {
        console.error('[SIMPLE REGISTER] Inner user creation error:', innerError);
        
        // Handle specific database errors with better messaging
        if (innerError instanceof Error) {
          // Re-throw to be handled by outer catch block
          if (innerError.message.includes('unique') || innerError.message.includes('duplicate')) {
            console.log('[SIMPLE REGISTER] Detected duplicate username issue');
            return res.status(409).json({ 
              error: 'Username already exists',
              code: 'DUPLICATE_USERNAME'
            });
          }
          
          // Database connection issues
          if (innerError.message.includes('connection') || 
              innerError.message.includes('timeout') ||
              innerError.message.includes('ECONNREFUSED')) {
            
            console.log('[SIMPLE REGISTER] Database connection issue detected, sending 503 response');
            return res.status(503).json({
              error: 'Registration service temporarily unavailable, please try again in a moment',
              retryAfter: 3,
              temporaryError: true,
              code: 'SERVICE_UNAVAILABLE'
            });
          }
        }
        
        // Re-throw other errors to be handled by outer catch
        throw innerError;
      }
      
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
      let statusCode = 500;
      let errorCode = 'REGISTRATION_FAILED';
      
      if (createError instanceof Error) {
        console.error('[SIMPLE REGISTER] Error type:', createError.constructor.name);
        console.error('[SIMPLE REGISTER] Error message:', createError.message);
        
        if (createError.message.includes('unique constraint') || createError.message.includes('duplicate')) {
          errorMessage = 'Username already exists';
          statusCode = 409;
          errorCode = 'DUPLICATE_USERNAME';
        } else if (createError.message.includes('connection') || createError.message.includes('timeout')) {
          errorMessage = 'Database connection issue, please try again';
          statusCode = 503;
          errorCode = 'SERVICE_UNAVAILABLE';
        }
      }
      
      return res.status(statusCode).json({ 
        error: errorMessage,
        code: errorCode
      });
    }
  } catch (error) {
    console.error('[SIMPLE REGISTER] Unexpected error:', error);
    
    // Enhanced error logging for debugging
    if (error instanceof Error) {
      console.error('[SIMPLE REGISTER] Error name:', error.name);
      console.error('[SIMPLE REGISTER] Error message:', error.message);
      console.error('[SIMPLE REGISTER] Error stack:', error.stack);
      
      // Log any additional properties on the error object
      const errorProps = Object.getOwnPropertyNames(error).filter(prop => prop !== 'name' && prop !== 'message' && prop !== 'stack');
      if (errorProps.length > 0) {
        console.error('[SIMPLE REGISTER] Additional error properties:', 
          errorProps.reduce((obj, prop) => {
            obj[prop] = (error as any)[prop];
            return obj;
          }, {} as Record<string, any>)
        );
      }
    } else {
      console.error('[SIMPLE REGISTER] Non-Error object thrown:', typeof error, JSON.stringify(error));
    }
    
    // Fallback error response with more details
    return res.status(500).json({ 
      error: 'An unexpected error occurred during registration',
      details: error instanceof Error ? error.message : String(error),
      errorType: error instanceof Error ? error.name : typeof error
    });
  }
}

/**
 * Register the handler with the router for normal usage
 */
router.post('/simple-register', simpleRegisterHandler);

export const simpleRegisterRouter = router;