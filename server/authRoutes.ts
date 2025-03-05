import { Request, Response, Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { storage } from './storage';
import { insertUserSchema, UserResponse } from '@shared/schema';
import { z } from 'zod';

// Password reset schemas
const resetPasswordRequestSchema = z.object({
  username: z.string().min(1, "Username is required")
});

const resetPasswordSchema = z.object({
  username: z.string().min(1, "Username is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters")
});

const router = Router();

// Helper function for retrying operations with backoff
const retryOperation = async <T>(operation: () => Promise<T>, maxRetries: number = 3, retryDelay: number = 1000): Promise<T> => {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Add a small delay between retries, but not on first attempt
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
      }
      return await operation();
    } catch (error) {
      console.error(`Database operation failed (attempt ${attempt + 1}/${maxRetries}):`, error);
      lastError = error;
      
      // Only retry on connection issues, not on logical errors
      if (!(error instanceof Error && 
          (error.message.includes('connection') || 
            error.message.includes('timeout') || 
            error.message.includes('unavailable')))) {
        throw error;
      }
      
      console.log(`Retrying operation in ${retryDelay * (attempt + 1)}ms...`);
    }
  }
  throw lastError;
};

// Login route with improved error handling and retry logic
router.post('/login', (req: Request, res: Response, next) => {
  // Custom authenticate function with retry logic
  const authenticateWithRetry = async () => {
    return new Promise<void>((resolve, reject) => {
      passport.authenticate('local', async (err: Error, user: UserResponse, info: { message: string }) => {
        if (err) {
          // For database connection errors, we might want to retry
          if (err.message && (err.message.includes('connection') || err.message.includes('timeout'))) {
            console.error('Database connection error during authentication:', err);
            return reject({
              status: 503,
              message: 'Service temporarily unavailable. Please try again later.'
            });
          }
          return reject(err);
        }
        
        if (!user) {
          return reject({
            status: 401,
            message: info.message || 'Invalid credentials'
          });
        }
        
        req.login(user, (loginErr) => {
          if (loginErr) {
            return reject(loginErr);
          }
          
          return resolve();
        });
      })(req, res, next);
    });
  };
  
  // Execute with retry logic
  (async () => {
    try {
      // Configure retry settings based on environment
      const isProd = process.env.NODE_ENV === 'production';
      const maxRetries = isProd ? 3 : 1;
      
      await retryOperation(authenticateWithRetry, maxRetries);
      
      // If we reach here, authentication was successful
      return res.json({
        message: 'Login successful',
        user: req.user
      });
    } catch (error) {
      console.error('Authentication error:', error);
      
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        return res.status(error.status as number).json({ message: error.message });
      }
      
      return res.status(500).json({ 
        message: 'Login failed due to server error. Please try again later.' 
      });
    }
  })();
});

// Logout route
router.post('/logout', (req: Request, res: Response) => {
  req.logout(() => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Error logging out' });
      }
      res.clearCookie('connect.sid');
      return res.json({ message: 'Logout successful' });
    });
  });
});

// Check authentication status and get current user with retry logic
router.get('/session', async (req: Request, res: Response) => {
  try {
    // If user is already authenticated in session, return immediately
    if (req.isAuthenticated()) {
      const user = req.user as UserResponse;
      return res.json({ authenticated: true, user });
    }
    
    // Nothing to retry for unauthenticated users
    return res.json({ authenticated: false, user: null });
  } catch (error) {
    console.error('Session check error:', error);
    // Even if there's an error, don't fail the request - just return unauthenticated
    return res.json({ 
      authenticated: false, 
      user: null,
      error: 'Failed to verify authentication status'
    });
  }
});

// Register a new user
router.post('/register', async (req: Request, res: Response) => {
  try {
    // First validate the input data
    const registerSchema = insertUserSchema
      .omit({ password: true }) // Remove password from schema
      .extend({
        password: z.string().min(6, 'Password must be at least 6 characters'),
        confirmPassword: z.string()
      })
      .refine(data => data.password === data.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword']
      });
    
    const validatedData = registerSchema.parse(req.body);
    
    // Track if we're in production mode for different error handling strategies
    const isProd = process.env.NODE_ENV === 'production';
    
    // Define retry settings based on environment
    const MAX_RETRIES = isProd ? 3 : 1;
    const RETRY_DELAY = 1000; // ms between retries
    
    // Check if username already exists with retry logic
    let existingUser;
    try {
      existingUser = await retryOperation(async () => {
        return await storage.getUserByUsername(validatedData.username);
      });
    } catch (dbError) {
      console.error('Database error checking user existence after retries:', dbError);
      return res.status(503).json({ 
        message: 'Service temporarily unavailable. Please try again later.',
        error: 'database_error'
      });
    }
    
    if (existingUser) {
      return res.status(409).json({ message: 'Username already exists' });
    }
    
    // Hash the password
    let passwordHash;
    try {
      passwordHash = await bcrypt.hash(validatedData.password, 10);
    } catch (hashError) {
      console.error('Password hashing error:', hashError);
      return res.status(500).json({ message: 'Registration failed during password processing' });
    }
    
    // Create user without confirmPassword
    const { confirmPassword, ...userData } = validatedData;
    
    let newUser;
    try {
      newUser = await retryOperation(async () => {
        return await storage.createUser({
          ...userData,
          password: passwordHash,
          displayName: userData.displayName || userData.username
        });
      });
    } catch (createError) {
      console.error('User creation error after retries:', createError);
      
      // Provide more informative error message with fallback timeout
      if (createError instanceof Error && 
          (createError.message.includes('connect') || 
           createError.message.includes('timeout'))) {
        return res.status(503).json({ 
          message: 'Database connection issue. Please try again in a few minutes.',
          error: 'connection_timeout'
        });
      }
      
      return res.status(503).json({ 
        message: 'Unable to create user account. Please try again later.',
        error: 'create_user_error'
      });
    }
    
    // Return user without password
    const { password, ...userWithoutPassword } = newUser;
    
    // Automatically log the user in after registration
    req.login(userWithoutPassword, (err) => {
      if (err) {
        console.error('Login after registration error:', err);
        // Still return success since user was created, but with a note
        return res.status(201).json({
          message: 'Account created successfully, but automatic login failed. Please log in manually.',
          user: userWithoutPassword,
          loginSuccessful: false
        });
      }
      
      return res.status(201).json({
        message: 'Registration successful',
        user: userWithoutPassword,
        loginSuccessful: true
      });
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: 'Invalid registration data',
        errors: error.errors
      });
    }
    
    console.error('Registration error:', error);
    return res.status(500).json({ 
      message: 'Registration failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Update user settings (display name)
router.put('/user', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    const user = req.user as UserResponse;
    const { displayName } = req.body;
    
    // TODO: Implement storage.updateUser method
    
    return res.json({ 
      message: 'User settings updated',
      user: {
        ...user,
        displayName: displayName || user.displayName
      }
    });
  } catch (error) {
    console.error('Error updating user settings:', error);
    return res.status(500).json({ message: 'Failed to update user settings' });
  }
});

// Change password
router.post('/change-password', async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Not authenticated' });
    }
    
    const user = req.user as UserResponse & { password: string };
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Validate input
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'New passwords do not match' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    
    // Verify current password
    const currentUser = await storage.getUser(user.id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const isPasswordValid = await bcrypt.compare(currentPassword, currentUser.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // TODO: Implement storage.updateUser method to update password
    
    return res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({ message: 'Failed to change password' });
  }
});

// Password reset request (find account)
router.post('/reset-password-request', async (req: Request, res: Response) => {
  try {
    // Validate input
    const validatedData = resetPasswordRequestSchema.parse(req.body);
    
    // Check if user exists
    const user = await storage.getUserByUsername(validatedData.username);
    if (!user) {
      // For security reasons, we still return success even if user doesn't exist
      // This prevents username enumeration attacks
      return res.json({ 
        message: 'If an account with that username exists, you can now reset the password' 
      });
    }
    
    // In a real application, we would typically:
    // 1. Generate a token
    // 2. Store the token with an expiration time
    // 3. Send an email or SMS with a reset link
    
    // For our demonstration app, we'll simply allow the reset without email verification
    // since we're building a family-friendly app
    
    return res.json({ 
      message: 'Account verified. You can now reset your password',
      verified: true
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: 'Invalid username format',
        errors: error.errors
      });
    }
    
    console.error('Password reset request error:', error);
    return res.status(500).json({ message: 'Password reset request failed' });
  }
});

// Reset password (set new password)
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    // Validate input
    const validatedData = resetPasswordSchema.parse(req.body);
    
    // Get user
    const user = await storage.getUserByUsername(validatedData.username);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Hash new password
    const passwordHash = await bcrypt.hash(validatedData.newPassword, 10);
    
    // Update user with new password in database
    // For now, we'll just use the database directly until updateUser is implemented
    const updated = await storage.updateUser(user.id, { password: passwordHash });
    
    if (!updated) {
      return res.status(500).json({ message: 'Failed to update password' });
    }
    
    return res.json({ message: 'Password has been reset successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: 'Invalid reset data',
        errors: error.errors
      });
    }
    
    console.error('Password reset error:', error);
    return res.status(500).json({ message: 'Password reset failed' });
  }
});

export default router;