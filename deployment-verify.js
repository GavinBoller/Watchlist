// Simple deployment verification script
console.log("=== Deployment Verification ===");
console.log("Node version:", process.version);
console.log("Environment:", process.env.NODE_ENV || "development");
console.log("TMDB API Key Available:", process.env.TMDB_API_KEY ? "Yes" : "No");
console.log("===============================");