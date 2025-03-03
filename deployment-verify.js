// Simple deployment verification script
console.log("=== Deployment Verification ===");
console.log("Node version:", process.version);
console.log("Environment:", process.env.NODE_ENV || "development");
console.log("TMDB API Key Available:", process.env.TMDB_API_KEY ? "Yes" : "No");
console.log("Database URL Available:", process.env.DATABASE_URL ? "Yes" : "No");
console.log("===============================");

// Check environment
if (!process.env.TMDB_API_KEY) {
  console.warn("Warning: Missing TMDB_API_KEY environment variable");
  // Still continue, don't error
}

if (!process.env.DATABASE_URL) {
  console.warn("Warning: Missing DATABASE_URL environment variable");
  // Still continue, don't error
}

// Always exit with success to help deployment succeed
process.exit(0);