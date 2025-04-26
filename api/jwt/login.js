export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const jwt = require('jsonwebtoken');
    const bcrypt = require('bcryptjs');
  
    // Simple validation
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
  
    // Mock user lookup (replace with database later)
    const mockGetUserByUsername = async (username) => {
      if (username === 'testuser') {
        return {
          userId: 1,
          username: 'testuser',
          password: '$2a$10$examplehashedpassword1234567890', // Mock bcrypt hash
          displayName: 'Test User',
          createdAt: new Date().toISOString()
        };
      }
      return null;
    };
  
    // Look up user
    const user = await mockGetUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
    }
  
    // Compare passwords with bcrypt
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password', code: 'INVALID_CREDENTIALS' });
    }
  
    // Generate JWT token
    const userResponse = {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName || user.username,
      createdAt: user.createdAt
    };
    const token = jwt.sign(userResponse, process.env.JWT_SECRET || 'your-jwt-secret', { expiresIn: '7d' });
  
    return res.status(200).json({
      token,
      user: userResponse
    });
  }