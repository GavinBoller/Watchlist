import { VercelRequest, VercelResponse } from '@vercel/node';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from 'server/db'; // Updated to use absolute paths
import { users } from 'server/schema'; // Updated to use absolute path

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password, displayName } = req.body;
  if (!username || !password || !displayName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const [newUser] = await db.insert(users).values({
      username,
      password: hashedPassword,
      displayName,
      createdAt: new Date().toISOString(),
    }).returning();

    const secret = process.env.JWT_SECRET as string;
    const token = jwt.sign(
      { userId: newUser.id, username: newUser.username },
      secret,
      { expiresIn: '1h' }
    );

    return res.status(201).json({
      token,
      user: {
        userId: newUser.id,
        username: newUser.username,
        displayName: newUser.displayName,
        createdAt: newUser.createdAt,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: 'Failed to register user', details: errorMessage });
  }
}