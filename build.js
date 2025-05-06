const { execSync } = require('child_process');

console.log('Running backend build...');
execSync('npm run build:api', { stdio: 'inherit' });

console.log('Running frontend build...');
execSync('npm run build', { stdio: 'inherit' });

console.log('Build completed.');
