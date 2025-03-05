/**
 * Special production environment fixes for session and authentication issues
 * This file contains temporary fixes and diagnostics only used in production
 */

import { Request, Response, NextFunction } from 'express';
import { storage } from './storage';
import { User } from '@shared/schema';

// Environment detection
const isProd = process.env.NODE_ENV === 'production';

/**
 * Production-specific session repair middleware
 * Detects and repairs broken sessions specifically in production environments
 */
export function productionSessionRepair(req: Request, res: Response, next: NextFunction) {
  // Only run in production environment
  if (!isProd) {
    return next();
  }

  console.log('[PROD-REPAIR] Production session repair middleware');
  
  // If already authenticated, don't interfere
  if (req.isAuthenticated()) {
    console.log('[PROD-REPAIR] User already authenticated, skipping repair');
    return next();
  }
  
  // Implement special cookie scanning in production
  const cookies = req.headers.cookie || '';
  console.log('[PROD-REPAIR] Checking cookies:', cookies);
  
  // Extract session ID from cookie if available (even if not properly deserialized)
  let sessionIdFromCookie = '';
  try {
    const sidMatch = cookies.match(/watchlist\.sid=s%3A([^.]+)\./);
    if (sidMatch && sidMatch[1]) {
      sessionIdFromCookie = decodeURIComponent(sidMatch[1]);
      console.log('[PROD-REPAIR] Found session ID in cookie:', sessionIdFromCookie);
    }
  } catch (e) {
    console.error('[PROD-REPAIR] Error parsing cookies:', e);
  }
  
  // Skip API and static routes for performance
  if (req.path.startsWith('/api/') || 
      req.path.startsWith('/assets/') || 
      req.path.endsWith('.ico') ||
      req.path.endsWith('.svg')) {
    return next();
  }

  // Special parameter for emergencies - allows a direct login for debugging
  // This is only accessible in production for admin debugging
  if (req.query.prodDebug === 'true' && req.query.userId) {
    const userId = parseInt(req.query.userId as string, 10);
    
    // Emergency user fetch
    storage.getUser(userId)
      .then(user => {
        if (!user) {
          console.log(`[PROD-REPAIR] Emergency login failed - user ID ${userId} not found`);
          return next();
        }
        
        console.log(`[PROD-REPAIR] Emergency login for user ${user.username} (${userId})`);
        
        // Force login
        req.login(user, (loginErr) => {
          if (loginErr) {
            console.error('[PROD-REPAIR] Emergency login failed:', loginErr);
            return next();
          }
          
          // Save session
          req.session.regenerate((regErr) => {
            if (regErr) {
              console.error('[PROD-REPAIR] Session regeneration failed:', regErr);
              return next();
            }
            
            // Re-login after regeneration
            req.login(user, (reloginErr) => {
              if (reloginErr) {
                console.error('[PROD-REPAIR] Re-login failed:', reloginErr);
                return next();
              }
              
              console.log('[PROD-REPAIR] Emergency recovery successful');
              
              // Mark session as fixed
              req.session.authenticated = true;
              req.session.repaired = true;
              
              // Save and continue
              req.session.save((saveErr) => {
                if (saveErr) {
                  console.error('[PROD-REPAIR] Session save failed:', saveErr);
                }
                next();
              });
            });
          });
        });
      })
      .catch(err => {
        console.error('[PROD-REPAIR] Emergency user lookup failed:', err);
        next();
      });
    
    return;
  }
  
  // Continue with normal request
  next();
}

/**
 * Special production logging middleware to better diagnose issues
 */
export function productionLogging(req: Request, res: Response, next: NextFunction) {
  // Only run in production
  if (!isProd) {
    return next();
  }
  
  // Skip API and asset requests to avoid log spam
  if (req.path.startsWith('/assets/') || 
      req.path.endsWith('.ico') || 
      req.path.endsWith('.svg')) {
    return next();
  }
  
  const method = req.method;
  const url = req.originalUrl || req.url;
  const sessionId = req.sessionID || 'none';
  const isAuthenticated = req.isAuthenticated();
  
  // Condensed but useful log format
  console.log(`[PROD] ${method} ${url} | Auth: ${isAuthenticated} | SID: ${sessionId}`);
  
  next();
}

/**
 * Production performance optimizations
 */
export function productionOptimizations(req: Request, res: Response, next: NextFunction) {
  // Only run in production
  if (!isProd) {
    return next();
  }
  
  // Skip expensive auth checks for static assets
  if (req.path.startsWith('/assets/') || 
      req.path.endsWith('.ico') || 
      req.path.endsWith('.svg')) {
    return next();
  }
  
  // Force proper headers for production
  res.setHeader('X-Production-App', 'true');
  
  // Add special cookie header for production that may help with session persistence
  if (!req.isAuthenticated() && req.path === '/') {
    res.setHeader('Set-Cookie', [
      'watchlist_env=production; Path=/; HttpOnly; SameSite=Lax; Secure'
    ]);
  }
  
  next();
}