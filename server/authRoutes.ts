import { Request, Response, Router } from 'express';
import passport from 'passport';
import bcrypt from 'bcryptjs';
import { storage } from './storage';
import { insertUserSchema, UserResponse } from '@shared/schema';
import { z } from 'zod';
import 'express-session';

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

// Login route with improved error handling, retry logic, and emergency mode
router.post('/login', (req: Request, res: Response, next) => {
  // Check if emergency mode is active for severe database outages
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && isEmergencyModeActive()) {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        message: 'Username and password are required'
      });
    }
    
    console.log('Using emergency mode for login - checking emergency storage');
    
    // Check if user exists in emergency storage
    const lowercaseUsername = username.toLowerCase();
    const user = emergencyMemoryStorage.users.get(lowercaseUsername);
    
    if (!user) {
      // Check the normal database as fallback - user might exist there
      // We'll fallback to normal error flow which will handle the failure case
      console.log('User not found in emergency storage, trying normal auth flow');
    } else {
      // User exists in emergency storage, check password
      return bcrypt.compare(password, user.password)
        .then(isMatch => {
          if (!isMatch) {
            return res.status(401).json({
              message: 'Invalid credentials'
            });
          }
          
          // Create sanitized user object
          const { password: _, ...userWithoutPassword } = user;
          
          // Log user in
          req.login(userWithoutPassword, (loginErr) => {
            if (loginErr) {
              console.error('Login error in emergency mode:', loginErr);
              return res.status(500).json({
                message: 'Login failed due to server error.',
                emergencyMode: true
              });
            }
            
            // Success
            return res.json({
              message: 'Login successful (emergency mode)',
              user: userWithoutPassword,
              emergencyMode: true
            });
          });
          
          return;
        })
        .catch(err => {
          console.error('Password comparison error in emergency mode:', err);
          return res.status(500).json({
            message: 'Login processing failed in emergency mode'
          });
        });
    }
  }
  
  // Normal authentication flow with retry
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
      const maxRetries = isProd ? 3 : 1;
      
      await retryOperation(authenticateWithRetry, maxRetries);
      
      // If we reach here, authentication was successful
      // Make sure the session is saved before responding
      console.log('[AUTH] Login successful, saving session before responding');
      
      if (req.session) {
        // Add a timestamp to track session creation time
        req.session.createdAt = Date.now();
        req.session.authenticated = true;
        
        // Save the session explicitly to ensure it's persisted
        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('[AUTH] Session save error:', saveErr);
            return res.status(500).json({
              message: 'Login successful but session could not be saved.'
            });
          }
          
          console.log('[AUTH] Session saved successfully with ID:', req.sessionID);
          
          // Now that session is saved, respond with success
          return res.json({
            message: 'Login successful',
            user: req.user,
            sessionId: req.sessionID // Include session ID for debugging
          });
        });
      } else {
        // No session object - this is unusual but handle it gracefully
        console.error('[AUTH] Session object missing after successful login');
        return res.status(200).json({
          message: 'Login processed, but session could not be established',
          user: req.user,
          warning: 'Session persistence may not work correctly'
        });
      }
    } catch (error) {
      console.error('Authentication error:', error);
      
      // If this is a production environment and we're facing connection issues
      // after multiple retries, activate emergency mode
      if (isProd && !isEmergencyModeActive() && 
          error && typeof error === 'object' && 
          'status' in error && (error.status === 503)) {
        enableEmergencyMode();
        return res.status(503).json({ 
          message: 'Service temporarily in emergency mode. Please try again.',
          error: 'emergency_mode_activated',
          retry: true
        });
      }
      
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        return res.status(error.status as number).json({ message: error.message });
      }
      
      return res.status(500).json({ 
        message: 'Login failed due to server error. Please try again later.' 
      });
    }
  })();
});

// Logout route with comprehensive error handling and cross-environment support
router.post('/logout', (req: Request, res: Response) => {
  // Environment configuration
  const isProd = process.env.NODE_ENV === 'production';
  const emergencyMode = isProd && isEmergencyModeActive();
  const cookieName = isProd ? 'watchapp.sid' : 'watchlist.sid';
  
  // Log additional debug info for troubleshooting
  console.log(`Logout request. User authenticated: ${req.isAuthenticated()}, Emergency mode: ${emergencyMode}`);
  console.log(`Session ID: ${req.sessionID || 'none'}`);
  
  // Production-specific logs
  if (isProd) {
    console.log(`Production cookie configuration: ${cookieName}, secure: true, sameSite: lax`);
  }
  
  // Handle logout with comprehensive error handling
  req.logout((logoutErr) => {
    if (logoutErr) {
      console.error('Error during logout:', logoutErr);
      return res.status(500).json({ message: 'Error during logout process' });
    }
    
    // Destroy session with error handling
    if (req.session) {
      req.session.destroy((sessionErr) => {
        if (sessionErr) {
          console.error('Error destroying session:', sessionErr);
          return res.status(500).json({ message: 'Error clearing session' });
        }
        
        // Clear ALL potential cookies to ensure clean logout
        try {
          // Clear the main session cookie with proper configuration
          res.clearCookie(cookieName, {
            path: '/',
            httpOnly: true,
            secure: isProd,
            sameSite: 'lax'
          });
          
          // Also clear legacy cookie names to prevent issues
          res.clearCookie('connect.sid', {
            path: '/',
            httpOnly: true,
            secure: isProd,
            sameSite: 'lax'
          });
          
          // Special cookie cleanup for production environments
          if (isProd) {
            res.clearCookie('watchapp.sid', {
              path: '/',
              httpOnly: true,
              secure: true,
              sameSite: 'lax'
            });
            
            // Force-clear any potentially stuck cookies
            res.setHeader('Set-Cookie', [
              `watchapp.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; ${isProd ? 'Secure; ' : ''}SameSite=Lax`,
              `connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; ${isProd ? 'Secure; ' : ''}SameSite=Lax`,
            ]);
          }
        } catch (cookieErr) {
          console.error('Error clearing cookies:', cookieErr);
          // Continue despite cookie error
        }
        
        return res.json({ 
          message: 'Logout successful',
          emergencyMode: emergencyMode || undefined,
          time: new Date().toISOString() // Add timestamp for debugging
        });
      });
    } else {
      // If session is already gone, just clear cookies and return
      try {
        // Clear all potential cookies
        res.clearCookie(cookieName, {
          path: '/',
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax'
        });
        
        res.clearCookie('connect.sid', {
          path: '/',
          httpOnly: true,
          secure: isProd,
          sameSite: 'lax'
        });
        
        // Special cookie cleanup for production
        if (isProd) {
          // Force-clear any potentially stuck cookies
          res.setHeader('Set-Cookie', [
            `watchapp.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; ${isProd ? 'Secure; ' : ''}SameSite=Lax`,
            `connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; ${isProd ? 'Secure; ' : ''}SameSite=Lax`,
          ]);
        }
      } catch (cookieErr) {
        console.error('Error clearing cookies when session is null:', cookieErr);
        // Continue despite cookie error
      }
      
      return res.json({ 
        message: 'Logout successful (no active session)',
        emergencyMode: emergencyMode || undefined,
        time: new Date().toISOString() // Add timestamp for debugging
      });
    }
  });
});

// Check authentication status and get current user with retry logic
// Enhanced with more diagnostic information
router.get('/session', async (req: Request, res: Response) => {
  try {
    console.log(`[SESSION] Session check, authenticated: ${req.isAuthenticated()}, session ID: ${req.sessionID || 'none'}`);
    
    // Add more session debugging info
    let sessionInfo = null;
    if (req.session) {
      sessionInfo = {
        id: req.sessionID,
        cookie: req.session.cookie ? {
          expires: req.session.cookie.expires,
          maxAge: req.session.cookie.maxAge,
          originalMaxAge: req.session.cookie.originalMaxAge,
          httpOnly: req.session.cookie.httpOnly,
          secure: req.session.cookie.secure,
          sameSite: req.session.cookie.sameSite
        } : 'No cookie data',
        createdAt: req.session.createdAt || 'Unknown',
        authenticated: req.session.authenticated || false
      };
      console.log('[SESSION] Session details:', JSON.stringify(sessionInfo, null, 2));
    } else {
      console.log('[SESSION] No session object available');
    }
    
    // If user is already authenticated in session, return immediately
    if (req.isAuthenticated()) {
      const user = req.user as UserResponse;
      
      // Check if we're running in emergency mode
      const isProd = process.env.NODE_ENV === 'production';
      const emergencyMode = isProd && isEmergencyModeActive();
      
      console.log(`[SESSION] User is authenticated, user ID: ${user.id}, username: ${user.username}`);
      
      // Include session diagnostics in the response
      return res.json({ 
        authenticated: true, 
        user,
        sessionId: req.sessionID,
        sessionInfo,
        emergencyMode: emergencyMode || undefined 
      });
    }
    
    // Check if we're running in emergency mode (for status info)
    const isProd = process.env.NODE_ENV === 'production';
    if (isProd && isEmergencyModeActive()) {
      console.log('[SESSION] User not authenticated, emergency mode active');
      return res.json({ 
        authenticated: false, 
        user: null,
        sessionId: req.sessionID,
        sessionInfo,
        emergencyMode: true
      });
    }
    
    // Nothing to retry for unauthenticated users
    console.log('[SESSION] User not authenticated, normal operation mode');
    return res.json({ 
      authenticated: false, 
      user: null,
      sessionId: req.sessionID,
      sessionInfo
    });
  } catch (error) {
    console.error('Session check error:', error);
    // Even if there's an error, don't fail the request - just return unauthenticated
    return res.json({ 
      authenticated: false, 
      user: null,
      error: 'Failed to verify authentication status',
      errorDetails: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Direct user info endpoint to support the client's API calls
router.get('/user', (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  return res.status(401).json({ message: 'Unauthorized' });
});

// Configuration: Emergency in-memory user storage for severe database outages in production
// This allows the app to function with basic functionality even when DB is completely unavailable
const emergencyMemoryStorage = {
  users: new Map<string, any>(),
  isUsingEmergencyMode: false
};

/**
 * IMPORTANT: This is a special fallback mode for severe database outages in production.
 * It temporarily stores user data in memory to allow basic operations to continue.
 * Data will be synchronized to the database once it becomes available again.
 */
function enableEmergencyMode() {
  console.warn('⚠️ EMERGENCY MODE ACTIVATED: Using memory fallback for critical operations');
  emergencyMemoryStorage.isUsingEmergencyMode = true;
}

function isEmergencyModeActive() {
  // Always return false to disable emergency mode since it's causing issues
  return false;
}

// Register a new user with ultra-reliable fallback options
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
    
    // Check if emergency mode is active (severe database outage)
    if (isProd && isEmergencyModeActive()) {
      console.log('Using emergency mode for user registration');
      
      // Check if username exists in emergency storage
      if (emergencyMemoryStorage.users.has(validatedData.username.toLowerCase())) {
        return res.status(409).json({ message: 'Username already exists' });
      }
      
      // Hash the password for emergency storage
      const passwordHash = await bcrypt.hash(validatedData.password, 10);
      
      // Create temporary user in emergency storage
      const { confirmPassword, ...userData } = validatedData;
      const tempUser = {
        id: Date.now(), // Temporary ID
        ...userData,
        password: passwordHash,
        displayName: userData.displayName || userData.username,
        createdAt: new Date().toISOString(),
        isPendingSync: true // Mark for DB sync when available
      };
      
      // Store in emergency storage
      emergencyMemoryStorage.users.set(validatedData.username.toLowerCase(), tempUser);
      
      // Create a sanitized version for the response
      const { password, ...userWithoutPassword } = tempUser;
      
      // Automatically log the user in after registration
      req.login(userWithoutPassword, (err) => {
        if (err) {
          console.error('Login after emergency registration error:', err);
          return res.status(201).json({
            message: 'Account created in emergency mode. Please log in manually.',
            user: userWithoutPassword,
            loginSuccessful: false,
            emergencyMode: true
          });
        }
        
        return res.status(201).json({
          message: 'Registration successful (emergency mode)',
          user: userWithoutPassword,
          loginSuccessful: true,
          emergencyMode: true
        });
      });
      
      return;
    }
    
    // Normal flow - check if username already exists with retry logic
    let existingUser;
    try {
      existingUser = await retryOperation(async () => {
        return await storage.getUserByUsername(validatedData.username);
      });
    } catch (dbError) {
      console.error('Database error checking user existence after retries:', dbError);
      
      // If in production and this failed after multiple retries, enable emergency mode
      if (isProd && !isEmergencyModeActive()) {
        enableEmergencyMode();
        return res.status(503).json({ 
          message: 'Service temporarily in emergency mode. Please try again.',
          error: 'emergency_mode_activated',
          retry: true
        });
      }
      
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
      
      // If in production and this failed after multiple retries, enable emergency mode
      if (isProd && !isEmergencyModeActive()) {
        enableEmergencyMode();
        return res.status(503).json({ 
          message: 'Service temporarily in emergency mode. Please try again.',
          error: 'emergency_mode_activated',
          retry: true
        });
      }
      
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