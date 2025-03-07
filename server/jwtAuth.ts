import jwt from 'jsonwebtoken';
import { User, UserResponse } from '@shared/schema';

// Secret key for signing JWT tokens
// FIXED: Use a consistent secret for both dev and production
// This ensures tokens work reliably across environments
// Use hardcoded secret - we'll rely on the fallback for both environments
const JWT_SECRET = 'watchlist-app-secure-jwt-secret-8fb38d7c98a1'; 
const TOKEN_EXPIRATION = '7d'; // Token expiration time

// Log JWT secret for debug
console.log('[JWT] Using secret starting with:', JWT_SECRET.substring(0, 8) + '...');

// Omit password when creating payload for JWT
type UserPayload = Omit<User, 'password'>;

/**
 * Generate a JWT token for the authenticated user
 */
export function generateToken(user: UserPayload): string {
  const payload = {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username
  };
  
  console.log(`[JWT] Generating token for user: ${user.username} (ID: ${user.id})`);
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): UserResponse | null {
  try {
    console.log('[JWT] Verifying token with secret:', JWT_SECRET.substring(0, 3) + '...');
    console.log('[JWT] Token to verify (first 20 chars):', token.substring(0, 20) + '...');
    
    const decoded = jwt.verify(token, JWT_SECRET) as UserResponse;
    console.log('[JWT] Token decoded successfully:', JSON.stringify(decoded));
    return decoded;
  } catch (error) {
    // Enhanced error logging to help diagnose token issues
    console.error('[JWT] Token verification failed:', error);
    
    if (error instanceof jwt.JsonWebTokenError) {
      console.error('[JWT] Specific error type:', error.name);
      console.error('[JWT] Error message:', error.message);
    } else if (error instanceof jwt.TokenExpiredError) {
      console.error('[JWT] Token expired at:', error.expiredAt);
    }
    
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(header?: string): string | null {
  if (!header) return null;
  
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Create a UserResponse object from a User, omitting the password
 */
export function createUserResponse(user: User): UserResponse {
  const { password, ...userResponse } = user;
  return userResponse;
}