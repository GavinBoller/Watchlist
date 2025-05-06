const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Running backend build...');
execSync('npm run build:api', { stdio: 'inherit' });

console.log('Running frontend build...');
execSync('npm run build', { stdio: 'inherit' });

console.log('Copying frontend assets to output root...');
const sourceDir = path.join(__dirname, 'client', 'build');
const destDir = path.join(__dirname, '.vercel', 'output');
fs.mkdirSync(destDir, { recursive: true });

// Copy all files from client/build/ to .vercel/output/
fs.readdirSync(sourceDir).forEach(file => {
    const srcPath = path.join(sourceDir, file);
    const destPath = path.join(destDir, file);
    if (fs.lstatSync(srcPath).isDirectory()) {
        fs.cpSync(srcPath, destPath, { recursive: true });
    } else {
        fs.copyFileSync(srcPath, destPath);
    }
    console.log(`Copied ${srcPath} to ${destPath}`);
});

console.log('Listing files in .vercel/output:');
fs.readdirSync(destDir, { recursive: true }).forEach(file => {
    console.log(file);
});

console.log('Build completed.');