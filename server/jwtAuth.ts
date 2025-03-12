import jwt from 'jsonwebtoken';
import { User, UserResponse } from '@shared/schema';

// Secret key for signing JWT tokens
// In production, we use the environment variable if available
// In development, we use a hardcoded secret for consistency
const DEFAULT_SECRET = 'watchlist-app-extremely-secure-jwt-secret-key-8fb38d7c98a1';
export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
export const TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION || '7d'; // Token expiration time

// Store all possible secrets for verification (allows smooth transition between environments)
export const ALL_JWT_SECRETS = [JWT_SECRET];
// Add the default secret as a fallback for transitioning between environments
if (JWT_SECRET !== DEFAULT_SECRET) {
  ALL_JWT_SECRETS.push(DEFAULT_SECRET);
}

// Log JWT secret usage (without revealing the actual secret)
if (process.env.JWT_SECRET) {
  console.log('[JWT] Using production JWT secret from environment variable');
  console.log('[JWT] Fallback secrets configured for smooth transition:', ALL_JWT_SECRETS.length);
} else {
  console.log('[JWT] Using default JWT secret for development');
}

// Omit password when creating payload for JWT
type UserPayload = Omit<User, 'password'>;

/**
 * Generate a JWT token for the authenticated user
 */
export function generateToken(user: UserPayload): string {
  const payload = {
    id: user.id,
    username: user.username,
    displayName: user.displayName || user.username,
    environment: user.environment || 'development'
  };
  
  console.log(`[JWT] Generating token for user: ${user.username} (ID: ${user.id})`);
  // Use a simplified approach to avoid TypeScript errors
  try {
    // @ts-ignore - bypassing type checking for jsonwebtoken compatibility
    return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
  } catch (error) {
    console.error('[JWT] Error generating token:', error);
    // Fallback to default expiration of 7 days (604800 seconds)
    // @ts-ignore - bypassing type checking for jsonwebtoken compatibility
    return jwt.sign(payload, JWT_SECRET, { expiresIn: 604800 });
  }
}

/**
 * Verify and decode a JWT token
 * This function tries all available secrets to support tokens from different environments
 */
export function verifyToken(token: string): UserResponse | null {
  console.log('[JWT] Token to verify (first 20 chars):', token.substring(0, 20) + '...');
  
  // Try each secret until one works
  for (const secret of ALL_JWT_SECRETS) {
    try {
      console.log('[JWT] Attempting verification with secret:', secret.substring(0, 3) + '...');
      const decoded = jwt.verify(token, secret as jwt.Secret) as UserResponse;
      console.log('[JWT] Token decoded successfully with secret starting with:', secret.substring(0, 3) + '...');
      console.log('[JWT] Token payload:', JSON.stringify(decoded));
      
      // If we're using a fallback secret, refresh the token to use the current secret
      if (secret !== JWT_SECRET) {
        console.log('[JWT] Token was verified with a fallback secret - consider refreshing');
      }
      
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        console.error('[JWT] Token expired at:', error.expiredAt);
        return null; // Don't try other secrets if token is expired
      }
      
      // For other errors like signature mismatch, try the next secret
      console.log(`[JWT] Verification failed with secret starting with ${secret.substring(0, 3)}...: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // If we get here, all secrets failed
  console.error('[JWT] Token verification failed with all available secrets');
  return null;
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