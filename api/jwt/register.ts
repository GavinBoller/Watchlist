import { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../db'; // Adjust path based on your project structure
import { users } from '../schema'; // Adjust path based on your project structure

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

  // Hash the password
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    // Save user to the database
    const [newUser] = await db.insert(users).values({
      username,
      password: hashedPassword,
      displayName,
      createdAt: new Date().toISOString(),
    }).returning();

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
      user: {
        userId: newUser.userId,
        username: newUser.username,
        displayName: newUser.displayName,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to register user', details: error.message });
  }
}