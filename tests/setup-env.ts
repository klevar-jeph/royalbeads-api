// tests/setup-env.ts
// Runs BEFORE any test-file code executes. Sets the environment variables
// that modules read at import time (JWT secrets, Mongo URI placeholder).

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-aaaaaaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-bbbbbbbbbbbbbbbbbbbbbbbb';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.API_URL = 'http://localhost:8000/api';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAMESITE = 'lax';
process.env.EMAIL_PROVIDER = 'console';
// Relax rate limits so integration tests can make many requests.
process.env.RATE_LIMIT_WINDOW_MS = '900000';
process.env.RATE_LIMIT_MAX = '10000';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
// MONGODB_URI is set dynamically by setup.ts (in-memory server).
process.env.MONGODB_URI = 'mongodb://localhost:27017/royalbeads-test';
