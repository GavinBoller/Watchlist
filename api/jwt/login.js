import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from 'server/db'; // Updated to use absolute path
import { users } from 'server/schema'; // Updated to use absolute path
import { eq } from 'drizzle-orm';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const userResult = await db.select().from(users).where(eq(users.username, username)).limit(1);
      const user = userResult[0];
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
      }

      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
      }

      const userResponse = {
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        createdAt: user.createdAt
      };
      const token = jwt.sign(userResponse, process.env.JWT_SECRET || 'your-jwt-secret', { expiresIn: '7d' });

      return res.status(200).json({
        token,
        user: userResponse
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ error: 'Failed to log in', details: errorMessage });
    }
}