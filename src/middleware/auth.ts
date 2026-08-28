// src/middleware/auth.ts
// Authentication middleware.
//
// Provides three guards:
//   `requireAuth`      – requires a valid access token (Bearer header OR cookie).
//   `optionalAuth`     – attaches the user if a token is present, never fails.
//   `authenticateRefresh` – verifies a refresh token from the `refreshToken` cookie.
//
// On success the decoded payload is attached to `req.user`.

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyRefreshToken, RefreshTokenPayload } from '../utils/token';
import { AuthenticatedUser } from '../types/express';

export interface RefreshUser {
  id: string;
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return undefined;
  return token;
}

function sendUnauthorized(res: Response, message: string): void {
  res.status(401).json({ error: 'Unauthorized', message });
}

/**
 * Require a valid access token. Reads token from the Authorization header
 * (Bearer scheme) first, falling back to the `accessToken` cookie.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractBearerToken(req) ?? (req.cookies?.accessToken as string | undefined);
  if (!token) {
    sendUnauthorized(res, 'Authentication token is required.');
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role } as AuthenticatedUser;
    next();
  } catch (err) {
    sendUnauthorized(res, (err as Error).message);
  }
}

/**
 * Attach the authenticated user if a token is present, but do not fail when
 * absent. Useful for endpoints that behave differently for anonymous users.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req) ?? (req.cookies?.accessToken as string | undefined);
  if (!token) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role } as AuthenticatedUser;
  } catch {
    // Silently ignore invalid tokens for optional auth.
  }
  next();
}

/**
 * Verify a refresh token supplied via the `refreshToken` HTTP-only cookie.
 * Attaches the decoded subject to `req.user` as `{ id }`.
 */
export function authenticateRefresh(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) {
    sendUnauthorized(res, 'Refresh token is required.');
    return;
  }
  try {
    const payload: RefreshTokenPayload = verifyRefreshToken(token);
    req.user = { id: payload.sub, role: '' } as AuthenticatedUser;
    next();
  } catch (err) {
    sendUnauthorized(res, (err as Error).message);
  }
}
