import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'emergency-jwt-secret';

export const emergencyLogin = async (req: Request, res: Response) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const user = {
    id: -999,
    username,
    displayName: username,
    emergency: true
  };

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '1h' });

  console.log(`[EMERGENCY] Emergency login issued for ${username}`);
  return res.status(200).json({
    success: true,
    token,
    user,
    message: 'Emergency authentication successful. This is a temporary token for emergency access.'
  });
};