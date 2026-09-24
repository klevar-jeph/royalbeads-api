// src/middleware/rateLimiter.ts
// Rate-limiting middleware built on `express-rate-limit`.
//
// Separate limiters are exported for different sensitivity tiers so that
// public auth endpoints can be throttled harder than general API traffic.

import rateLimit, { Options as RateLimitOptions } from 'express-rate-limit';
import { env } from '../config/env';

const baseOptions: Partial<RateLimitOptions> = {
  standardHeaders: true,
  legacyHeaders: false,
  windowMs: env.rateLimit.windowMs,
};

/**
 * General API limiter. A generous ceiling applied to all routes.
 */
export const apiLimiter = rateLimit({
  ...baseOptions,
  max: env.rateLimit.max,
  message: { error: 'TooManyRequests', message: 'Too many requests, please slow down.' },
});

/**
 * Stricter limiter for authentication endpoints (login, register, reset).
 * Limits per IP to a small number of attempts within the window to blunt
 * credential stuffing and brute-force attacks.
 */
export const authLimiter = rateLimit({
  ...baseOptions,
  max: env.rateLimit.authMax,
  message: {
    error: 'TooManyRequests',
    message: 'Too many authentication attempts. Please try again later.',
  },
});

/**
 * Very strict limiter for password-change and other sensitive account routes.
 */
export const sensitiveLimiter = rateLimit({
  ...baseOptions,
  max: 3,
  message: {
    error: 'TooManyRequests',
    message: 'Too many requests for this operation. Please try again later.',
  },
});
