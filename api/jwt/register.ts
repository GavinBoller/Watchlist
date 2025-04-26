// Redeploy after moving vercel.json
// Force fresh deployment for syd1
import { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Ensure the request is a POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Extract username, password, and displayName from the request body
  const { username, password, displayName } = req.body;

  // Basic validation
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Mock user creation (we'll replace this with a database later)
  const newUser = {
    userId: 2, // Hardcoded for now (userId 1 is used in login.ts)
    username,
    displayName,
    createdAt: new Date().toISOString(),
  };

  // Generate a JWT token
  const secret = process.env.JWT_SECRET as string;
  const token = jwt.sign(
    { userId: newUser.userId, username: newUser.username },
    secret,
    { expiresIn: '1h' }
  );

  // Return the new user and token
  return res.status(201).json({
    token,
    user: newUser,
  });
}