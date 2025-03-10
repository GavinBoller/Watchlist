const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a canvas to draw on
const size = 512;
const canvas = createCanvas(size, size);
const ctx = canvas.getContext('2d');

// Fill the background with dark color
ctx.fillStyle = '#1a1a1a';
ctx.fillRect(0, 0, size, size);

// Draw the "W" letter
ctx.fillStyle = '#E50914'; // Netflix red
ctx.font = 'bold 300px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('W', size / 2, size / 2);

// Convert canvas to PNG buffer
const buffer = canvas.toBuffer('image/png');

// Save the image
fs.writeFileSync('./generated-icon.png', buffer);

console.log('Icon generated successfully!');