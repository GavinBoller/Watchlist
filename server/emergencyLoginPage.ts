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
        button, .button {
          background: #e11d48;
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          width: 100%;
          display: block;
          text-align: center;
          text-decoration: none;
          margin-bottom: 10px;
        }
        button:hover, .button:hover {
          background: #9f1239;
        }
        .note {
          font-size: 14px;
          color: #666;
          margin-top: 30px;
        }
        .super-emergency {
          margin-top: 30px;
          padding: 15px;
          border: 1px dashed #ccc;
          border-radius: 4px;
        }
        h2 {
          font-size: 18px;
          margin-bottom: 15px;
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
      
      <div class="super-emergency">
        <h2>Quick Access Emergency Links</h2>
        <p>Use these pre-configured links for immediate login:</p>
        <a href="#" class="button" onclick="loginWithPreset('Gavin100')">Login as Gavin100</a>
        <a href="#" class="button" onclick="loginWithPreset('Gaju101')">Login as Gaju101</a>
        <a href="#" class="button" onclick="loginWithDirectToken('Gavin100')">Super Emergency Login (Gavin100)</a>
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
        
        function loginWithPreset(username) {
          window.location.href = '/?emergencyLogin=true&user=' + encodeURIComponent(username) + '&directAuth=true';
        }
        
        function loginWithDirectToken(username) {
          // Get direct token and use it for authentication
          fetch('/api/emergency/raw-token/' + username)
            .then(response => response.json())
            .then(data => {
              if (data.token) {
                // Store token locally
                localStorage.setItem('jwt_token', data.token);
                sessionStorage.setItem('jwt_token', data.token);
                
                // Set emergency data
                sessionStorage.setItem('emergency_user', username);
                sessionStorage.setItem('emergency_auth', 'true');
                sessionStorage.setItem('emergency_timestamp', Date.now().toString());
                
                // Redirect with all params
                window.location.href = '/?token=' + data.token + '&emergencyLogin=true&user=' + username + '&directAuth=true&fullToken=true';
              } else {
                alert('Failed to get authentication token');
              }
            })
            .catch(error => {
              console.error('Error getting token:', error);
              alert('Error getting authentication token');
            });
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