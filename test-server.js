import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

// Serve the HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'verify-api.html'));
});

// Proxy requests to our main server
app.use('/api', (req, res) => {
  const url = `http://localhost:5000${req.url}`;
  console.log(`Proxying request to: ${url}`);
  
  fetch(url)
    .then(response => {
      // Copy all response headers
      Object.entries(response.headers).forEach(([key, value]) => {
        res.set(key, value);
      });
      
      // Set content type explicitly
      res.set('Content-Type', response.headers.get('content-type') || 'application/json');
      
      return response.text();
    })
    .then(text => {
      res.send(text);
    })
    .catch(error => {
      console.error('Proxy error:', error);
      res.status(500).send('Proxy error: ' + error.message);
    });
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Test server running at http://localhost:${PORT}`);
  console.log(`Visit http://localhost:${PORT} to verify API endpoints`);
});