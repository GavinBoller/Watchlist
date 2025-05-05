// This script creates a film icon and adds it to the page
// It runs when the page loads and adds the icon to localStorage
// This allows iOS to use it when adding to home screen

document.addEventListener('DOMContentLoaded', function() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  
  // Fill background color
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, 512, 512);
  
  // Create rounded corners for iOS icon
  ctx.beginPath();
  const radius = 512 * 0.23; // 23% border radius
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
  
  // Export to data URL
  const iconUrl = canvas.toDataURL('image/png');
  
  // Create a link element
  const iconLink = document.createElement('link');
  iconLink.rel = 'apple-touch-icon';
  iconLink.href = iconUrl;
  document.head.appendChild(iconLink);
  
  // Also store in localStorage for persistence
  localStorage.setItem('watchlist-icon', iconUrl);
  
  // Let iOS know this is a web app
  const metaWebApp = document.createElement('meta');
  metaWebApp.name = 'apple-mobile-web-app-capable';
  metaWebApp.content = 'yes';
  document.head.appendChild(metaWebApp);
  
  // Set the status bar style
  const metaStatusBar = document.createElement('meta');
  metaStatusBar.name = 'apple-mobile-web-app-status-bar-style';
  metaStatusBar.content = 'black-translucent';
  document.head.appendChild(metaStatusBar);
});