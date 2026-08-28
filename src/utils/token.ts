// src/utils/token.ts
// JWT utility functions for access and refresh tokens.
// Uses environment variables for secrets and expiration times.

import jwt, { SignOptions, VerifyErrors } from "jsonwebtoken";
import type { StringValue } from "ms";

// Types for token payloads. Extend as needed.
export interface AccessTokenPayload {
  sub: string; // user id
  role: string; // user role
  // add any additional claims here
}

export interface RefreshTokenPayload {
  sub: string; // user id
}

// Helper to get env vars with fallback defaults.
const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

// Secrets and expiration times (in seconds or string accepted by jsonwebtoken)
const ACCESS_SECRET = getEnv("JWT_ACCESS_SECRET");
const REFRESH_SECRET = getEnv("JWT_REFRESH_SECRET");
const ACCESS_EXPIRES_IN = getEnv("JWT_ACCESS_EXPIRES_IN", "15m") as StringValue; // e.g., "15m"
const REFRESH_EXPIRES_IN = getEnv("JWT_REFRESH_EXPIRES_IN", "7d") as StringValue; // e.g., "7d"

/**
 * Generate a signed access token.
 * @param payload - Minimal payload containing user id and role.
 */
export const generateAccessToken = (payload: AccessTokenPayload): string => {
  const options: SignOptions = {
    expiresIn: ACCESS_EXPIRES_IN,
    algorithm: "HS256",
  };
  return jwt.sign(payload, ACCESS_SECRET, options);
};

/**
 * Generate a signed refresh token.
 * @param payload - Payload with user id. Refresh tokens are long‑lived.
 */
export const generateRefreshToken = (payload: RefreshTokenPayload): string => {
  const options: SignOptions = {
    expiresIn: REFRESH_EXPIRES_IN,
    algorithm: "HS256",
  };
  return jwt.sign(payload, REFRESH_SECRET, options);
};

/**
 * Verify an access token.
 * @param token - JWT string from cookie/header.
 * @returns Decoded payload if valid, otherwise throws.
 */
export const verifyAccessToken = (
  token: string
): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
    return decoded;
  } catch (err) {
    const e = err as VerifyErrors;
    throw new Error(`Invalid access token: ${e.message}`);
  }
};

/**
 * Verify a refresh token.
 * @param token - JWT string.
 * @returns Decoded payload if valid, otherwise throws.
 */
export const verifyRefreshToken = (
  token: string
): RefreshTokenPayload => {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as RefreshTokenPayload;
    return decoded;
  } catch (err) {
    const e = err as VerifyErrors;
    throw new Error(`Invalid refresh token: ${e.message}`);
  }
};
