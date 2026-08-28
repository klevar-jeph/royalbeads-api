// src/config/env.ts
// Centralised environment variable loader with validation.
// Ensures required secrets are present at startup and exposes typed helpers.

type NodeEnv = 'development' | 'test' | 'production';

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development') as NodeEnv,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  isTest: process.env.NODE_ENV === 'test',

  port: int('PORT', 8000),

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/royalbeads'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  cookie: {
    secure: bool('COOKIE_SECURE', false),
    // SameSite policy: 'lax' is CSRF-safe for top-level navigations while
    // permitting cookies on same-site requests. Use 'none' only if you need
    // third-party cookies (and COOKIE_SECURE must then be true).
    sameSite: (optional('COOKIE_SAMESITE', 'lax') as 'lax' | 'strict' | 'none'),
  },

  frontendUrl: optional('FRONTEND_URL', 'http://localhost:3000'),
  apiUrl: optional('API_URL', 'http://localhost:8000/api'),

  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: int('RATE_LIMIT_MAX', 100),
    authMax: int('RATE_LIMIT_AUTH_MAX', 10),
  },

  email: {
    from: optional('EMAIL_FROM', 'Royalbeads <no-reply@royalbeads.local>'),
    provider: optional('EMAIL_PROVIDER', 'console') as 'console' | 'smtp',
  },
};

export type Env = typeof env;
