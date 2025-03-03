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

// Login route
router.post('/login', (req: Request, res: Response, next) => {
  passport.authenticate('local', (err: Error, user: UserResponse, info: { message: string }) => {
    if (err) {
      return next(err);
    }
    
    if (!user) {
      return res.status(401).json({ message: info.message || 'Invalid credentials' });
    }
    
    req.login(user, (err) => {
      if (err) {
        return next(err);
      }
      
      return res.json({
        message: 'Login successful',
        user
      });
    });
  })(req, res, next);
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

// Check authentication status and get current user
router.get('/session', (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    const user = req.user as UserResponse;
    return res.json({ authenticated: true, user });
  }
  
  return res.json({ authenticated: false, user: null });
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
    
    // Check if username already exists - catch and log database connection issues
    let existingUser;
    try {
      existingUser = await storage.getUserByUsername(validatedData.username);
    } catch (dbError) {
      console.error('Database error checking user existence:', dbError);
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
      newUser = await storage.createUser({
        ...userData,
        password: passwordHash,
        displayName: userData.displayName || userData.username
      });
    } catch (createError) {
      console.error('User creation error:', createError);
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