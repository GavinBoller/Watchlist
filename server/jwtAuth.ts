import jwt from 'jsonwebtoken';
import { User, UserResponse } from '@shared/schema';

// Secret key for signing JWT tokens
// In production, this should be in environment variables
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; 
const TOKEN_EXPIRATION = '7d'; // Token expiration time

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
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): UserResponse | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as UserResponse;
    return decoded;
  } catch (error) {
    console.error('[JWT] Token verification failed:', error);
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