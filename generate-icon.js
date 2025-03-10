import fs from 'fs';
import { createCanvas } from 'canvas';

// Create a canvas to draw on
const size = 512;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Fill the background with dark color
ctx.fillStyle = '#1a1a1a';
ctx.fillRect(0, 0, size, size);

// Draw film reel icon (matching the one used in the app header)
const centerX = size / 2;
const centerY = size / 2;
const reelRadius = 180;

// Draw main circle
ctx.strokeStyle = '#E50914'; // Netflix red
ctx.lineWidth = 16;
ctx.beginPath();
ctx.arc(centerX, centerY, reelRadius, 0, Math.PI * 2);
ctx.stroke();

// Draw film perforations (holes)
const drawPerforation = (x, y, radius) => {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.strokeStyle = '#E50914';
  ctx.lineWidth = 8;
  ctx.stroke();
};

// Draw the perforations around the circle
const perforationRadius = 30;
// Top, bottom, left, right
drawPerforation(centerX, centerY - reelRadius + perforationRadius, perforationRadius);
drawPerforation(centerX, centerY + reelRadius - perforationRadius, perforationRadius);
drawPerforation(centerX - reelRadius + perforationRadius, centerY, perforationRadius);
drawPerforation(centerX + reelRadius - perforationRadius, centerY, perforationRadius);

// Diagonal perforations
const diagonalOffset = reelRadius * 0.7;
drawPerforation(centerX - diagonalOffset, centerY - diagonalOffset, perforationRadius);
drawPerforation(centerX + diagonalOffset, centerY + diagonalOffset, perforationRadius);
drawPerforation(centerX - diagonalOffset, centerY + diagonalOffset, perforationRadius);
drawPerforation(centerX + diagonalOffset, centerY - diagonalOffset, perforationRadius);

// Central hub
drawPerforation(centerX, centerY, 45);

// Convert canvas to PNG buffer
const buffer = canvas.toBuffer('image/png');

// Save the image
fs.writeFileSync('./generated-icon.png', buffer);

console.log('Film reel icon generated successfully!');