import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a canvas using Node.js canvas
const canvas = createCanvas(512, 512);
const ctx = canvas.getContext('2d');

// Fill the canvas with the background color
ctx.fillStyle = '#141414';
ctx.fillRect(0, 0, 512, 512);

// Draw a rounded rectangle for iOS style
const cornerRadius = 512 * 0.23; // 23% border radius
ctx.beginPath();
ctx.moveTo(cornerRadius, 0);
ctx.lineTo(512 - cornerRadius, 0);
ctx.quadraticCurveTo(512, 0, 512, cornerRadius);
ctx.lineTo(512, 512 - cornerRadius);
ctx.quadraticCurveTo(512, 512, 512 - cornerRadius, 512);
ctx.lineTo(cornerRadius, 512);
ctx.quadraticCurveTo(0, 512, 0, 512 - cornerRadius);
ctx.lineTo(0, cornerRadius);
ctx.quadraticCurveTo(0, 0, cornerRadius, 0);
ctx.closePath();
ctx.clip();

// Draw the film icon
ctx.strokeStyle = '#E50914';
ctx.lineWidth = 10;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Main rectangle
ctx.strokeRect(65, 65, 382, 382);

// Vertical lines
ctx.beginPath();
ctx.moveTo(153, 65);
ctx.lineTo(153, 447);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(359, 65);
ctx.lineTo(359, 447);
ctx.stroke();

// Horizontal lines
ctx.beginPath();
ctx.moveTo(65, 153);
ctx.lineTo(447, 153);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(65, 359);
ctx.lineTo(447, 359);
ctx.stroke();

// Make sure the directory exists
if (!fs.existsSync(path.join(__dirname, 'public'))) {
  fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
}

// Save the canvas as a PNG file
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'public', 'watchlist-icon.png'), buffer);

console.log('Icon generated successfully!');