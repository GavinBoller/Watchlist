import { createCanvas } from 'canvas';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create a canvas with the dimensions 512x512
const canvas = createCanvas(512, 512);
const ctx = canvas.getContext('2d');

// Fill background color - Netflix black
ctx.fillStyle = '#141414';
ctx.fillRect(0, 0, 512, 512);

// Create rounded corners for iOS icon
ctx.beginPath();
const radius = 512 * 0.23; // 23% border radius for iOS
ctx.moveTo(radius, 0);
ctx.lineTo(512 - radius, 0);
ctx.quadraticCurveTo(512, 0, 512, radius);
ctx.lineTo(512, 512 - radius);
ctx.quadraticCurveTo(512, 512, 512 - radius, 512);
ctx.lineTo(radius, 512);
ctx.quadraticCurveTo(0, 512, 0, 512 - radius);
ctx.lineTo(0, radius);
ctx.quadraticCurveTo(0, 0, radius, 0);
ctx.closePath();
ctx.fill();

// Draw the film icon
ctx.strokeStyle = '#E50914'; // Netflix red
ctx.lineWidth = 25;
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

// Save the canvas to a PNG file
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(path.join(__dirname, 'generated-icon.png'), buffer);

console.log('Icon generated and saved as generated-icon.png');

// Also save to client/public directory for web use
const publicPath = path.join(__dirname, 'client', 'public');
if (!fs.existsSync(publicPath)) {
  fs.mkdirSync(publicPath, { recursive: true });
}
fs.writeFileSync(path.join(publicPath, 'apple-touch-icon.png'), buffer);
fs.writeFileSync(path.join(publicPath, 'icon-192.png'), buffer);
fs.writeFileSync(path.join(publicPath, 'icon-512.png'), buffer);

console.log('Icons also saved to client/public directory');