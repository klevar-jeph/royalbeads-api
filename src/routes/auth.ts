// src/routes/auth.ts
// Authentication router.
//
// Endpoints
//   POST /auth/register            – create an account (active immediately)
//   POST /auth/login               – exchange credentials for tokens (cookies)
//   POST /auth/refresh             – rotate tokens using the refresh cookie
//   POST /auth/logout              – clear auth cookies
//   GET  /auth/me                  – current user profile (requires auth)
//   POST /auth/change-password     – change password for the authenticated user
//
// NOTE: Email verification is intentionally NOT required — accounts are
// fully ACTIVE immediately upon registration. Password-reset endpoints
// live under /users/* (authenticated, account-settings) rather than /auth/*.

import { Router, Request, Response, NextFunction } from 'express';
import { User, UserRole, AccountStatus } from '../models/User';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/token';
import { env } from '../config/env';
import { validate, registerSchema, loginSchema } from '../validation/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';

export const authRouter = Router();

// --- Cookie helpers --------------------------------------------------------

const ACCESS_COOKIE = 'accessToken';
const REFRESH_COOKIE = 'refreshToken';

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: env.cookie.secure,
    sameSite: env.cookie.sameSite as 'lax' | 'strict' | 'none',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  // Parse expiration strings like "15m" / "7d" into milliseconds.
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(msFromExpiry(env.jwt.accessExpiresIn)));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(msFromExpiry(env.jwt.refreshExpiresIn)));
}

function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

function msFromExpiry(expiry: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(expiry.trim());
  if (!match) return 15 * 60 * 1000; // default 15 min
  const value = Number.parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 60_000);
}

// --- Token helpers ---------------------------------------------------------

function authTokensFor(userId: string, role: string): { access: string; refresh: string } {
  const access = generateAccessToken({ sub: userId, role });
  const refresh = generateRefreshToken({ sub: userId });
  return { access, refresh };
}

// --- Error helper -----------------------------------------------------------

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

// --- Public user serializer ------------------------------------------------

function publicUser(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role,
    status: user.status,
    referralCode: user.referralCode,
    emailVerified: true,
    phoneVerified: false,
    preferences: user.preferences
      ? {
          email: user.preferences.email,
          system: user.preferences.system,
          marketing: user.preferences.marketing,
        }
      : { email: true, system: true, marketing: false },
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// --- Routes ----------------------------------------------------------------

/**
 * POST /auth/register
 */
authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, referralCode, fullName, phone } = req.body;

      const existing = await User.findOne({ email });
      if (existing) {
        throw httpError(409, 'An account with that email already exists.');
      }

      // Resolve referral code (if any) to an inviter.
      let referredBy;
      if (referralCode) {
        const inviter = await User.findOne({ referralCode });
        if (!inviter) {
          throw httpError(400, 'Invalid referral code.');
        }
        referredBy = inviter._id;
      }

      const user = new User({
        fullName,
        email,
        phone,
        passwordHash: password, // hashed by pre('save') hook
        role: UserRole.USER,
        // status defaults to ACTIVE in the schema — no verification step.
        referredBy,
      });

      await user.save();

      const tokens = authTokensFor(user._id.toString(), user.role);
      setAuthCookies(res, tokens.access, tokens.refresh);

      res.status(201).json({
        message: 'Account created successfully.',
        user: publicUser(user),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/login
 */
authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email });
      if (!user) {
        // Use the same message for both to avoid user enumeration.
        throw httpError(401, 'Invalid email or password.');
      }

      const match = await user.comparePassword(password);
      if (!match) {
        throw httpError(401, 'Invalid email or password.');
      }

      if (user.status === AccountStatus.SUSPENDED) {
        throw httpError(403, 'Your account has been suspended.');
      }
      if (user.status === AccountStatus.DEACTIVATED) {
        throw httpError(403, 'Your account has been deactivated.');
      }

      const tokens = authTokensFor(user._id.toString(), user.role);
      setAuthCookies(res, tokens.access, tokens.refresh);

      // Record the login time (non-blocking; failure is non-fatal).
      user.lastLoginAt = new Date();
      await user.save();

      res.json({ message: 'Logged in.', user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/refresh
 */
authRouter.post('/refresh', authLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = (req.cookies?.refreshToken as string | undefined) ?? req.body?.refreshToken;
    if (!refreshToken) {
      throw httpError(401, 'Refresh token is required.');
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      clearAuthCookies(res);
      throw httpError(401, 'Invalid or expired refresh token.');
    }

    const user = await User.findById(payload.sub);
    if (!user || user.status !== AccountStatus.ACTIVE) {
      clearAuthCookies(res);
      throw httpError(401, 'User is no longer active.');
    }

    const tokens = authTokensFor(user._id.toString(), user.role);
    setAuthCookies(res, tokens.access, tokens.refresh);

    res.json({ message: 'Tokens refreshed.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout
 */
authRouter.post('/logout', (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.json({ message: 'Logged out.' });
});

/**
 * GET /auth/me
 */
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) {
      throw httpError(404, 'User not found.');
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default authRouter;
