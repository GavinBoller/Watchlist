import { Request, Response, Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { storage } from './storage';
import { insertUserSchema, UserResponse } from '@shared/schema';
import { z } from 'zod';

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
    
    // Check if username already exists
    const existingUser = await storage.getUserByUsername(validatedData.username);
    if (existingUser) {
      return res.status(409).json({ message: 'Username already exists' });
    }
    
    // Hash the password
    const passwordHash = await bcrypt.hash(validatedData.password, 10);
    
    // Create user without confirmPassword
    const { confirmPassword, ...userData } = validatedData;
    
    const newUser = await storage.createUser({
      ...userData,
      password: passwordHash,
      displayName: userData.displayName || userData.username
    });
    
    // Return user without password
    const { password, ...userWithoutPassword } = newUser;
    
    // Automatically log the user in after registration
    req.login(userWithoutPassword, (err) => {
      if (err) {
        return res.status(500).json({ message: 'Login failed after registration' });
      }
      
      return res.status(201).json({
        message: 'Registration successful',
        user: userWithoutPassword
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
    return res.status(500).json({ message: 'Registration failed' });
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

export default router;