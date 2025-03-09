/**
 * Emergency login page system for extreme fallback
 * This provides a completely independent authentication mechanism
 * that doesn't rely on any database or complex logic
 */

import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwtAuth';

const router = express.Router();

// Generate a very simple token for emergency purposes
function generateSimpleToken(username: string): string {
  const user = {
    id: -1,  // Use a negative ID to indicate this is an emergency login
    username,
    displayName: username,
    emergency: true
  };
  
  return jwt.sign(user, JWT_SECRET, { expiresIn: '24h' });
}

// Serve a simple emergency login page
router.get('/emergency-login', (req: Request, res: Response) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Emergency Login</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          padding: 40px;
          max-width: 600px;
          margin: 0 auto;
          text-align: center;
        }
        h1 {
          color: #e11d48;
        }
        p {
          line-height: 1.5;
          margin-bottom: 20px;
        }
        input {
          padding: 10px;
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 15px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 16px;
        }
        button {
          background: #e11d48;
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          width: 100%;
        }
        button:hover {
          background: #9f1239;
        }
        .note {
          font-size: 14px;
          color: #666;
          margin-top: 30px;
        }
      </style>
    </head>
    <body>
      <h1>Emergency Login</h1>
      <p>This page provides a special login mechanism when normal authentication fails.</p>
      
      <div>
        <label for="username">Username:</label>
        <input type="text" id="username" placeholder="Enter your username">
        <button onclick="login()">Emergency Login</button>
      </div>
      
      <p class="note">Note: This is a fallback mechanism and should only be used when regular login fails.</p>
      
      <script>
        function login() {
          const username = document.getElementById('username').value;
          if (!username) {
            alert('Please enter a username');
            return;
          }
          
          // Redirect to the app with emergency parameters
          window.location.href = '/?emergencyLogin=true&user=' + encodeURIComponent(username) + '&directAuth=true';
        }
      </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Emergency token generator - gives a token directly for a username
// This is the simplest possible authentication mechanism
router.get('/emergency/raw-token/:username', (req: Request, res: Response) => {
  const { username } = req.params;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  const token = generateSimpleToken(username);
  
  res.json({
    token,
    user: {
      id: -1,
      username,
      displayName: username,
      emergency: true
    }
  });
});

export const emergencyLoginRouter = router;