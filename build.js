const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Running backend build...');
execSync('npm run build:api', { stdio: 'inherit' });

console.log('Running frontend build...');
execSync('npm run build', { stdio: 'inherit' });

console.log('Copying frontend assets to root...');
const sourceDir = path.join(__dirname, 'client', 'build');
const destDir = path.join(__dirname, '.vercel', 'output', 'static');
fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(sourceDir, destDir, { recursive: true });

console.log('Build completed.');