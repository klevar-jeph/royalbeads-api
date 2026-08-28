// src/routes/auth.ts
// Authentication router.
//
// Endpoints
//   POST /auth/register            – create an account (sends verification email)
//   POST /auth/login               – exchange credentials for tokens (cookies)
//   POST /auth/refresh             – rotate tokens using the refresh cookie
//   POST /auth/logout              – clear auth cookies
//   GET  /auth/me                  – current user profile (requires auth)
//   POST /auth/verify-email        – verify an email verification token
//   POST /auth/resend-verification – resend the verification email
//   POST /auth/forgot-password     – request a password reset email
//   POST /auth/reset-password      – reset password with a token
//   POST /auth/change-password     – change password for the authenticated user

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { User, UserRole, AccountStatus } from '../models/User';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} from '../utils/token';
import { env } from '../config/env';
import {
  validate,
  registerSchema,
  loginSchema,
  emailVerificationSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../validation/auth';
import { authLimiter, sensitiveLimiter } from '../middleware/rateLimiter';
import { requireAuth } from '../middleware/auth';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../services/email';

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

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

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
    emailVerified: user.status === AccountStatus.ACTIVE,
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
        status: AccountStatus.PENDING_VERIFICATION,
        referredBy,
      });

      // Email verification token (single-use, 24h).
      user.emailVerificationToken = randomToken();
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await user.save();

      await sendVerificationEmail(user.email, user.emailVerificationToken!);

      res.status(201).json({
        message: 'Account created. Check your email to verify your account.',
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
      if (user.status === AccountStatus.PENDING_VERIFICATION) {
        throw httpError(403, 'Please verify your email before logging in.');
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

/**
 * POST /auth/verify-email
 */
authRouter.post(
  '/verify-email',
  authLimiter,
  validate(emailVerificationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = req.body;
      const user = await User.findOne({
        emailVerificationToken: token,
        emailVerificationExpires: { $gt: new Date() },
      });

      if (!user) {
        throw httpError(400, 'Invalid or expired verification token.');
      }

      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
      user.status = AccountStatus.ACTIVE;
      await user.save();

      res.json({ message: 'Email verified. You can now log in.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/resend-verification
 */
authRouter.post(
  '/resend-verification',
  sensitiveLimiter,
  validate(resendVerificationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      // Respond generically whether or not the user exists / is already verified
      // to prevent enumeration.
      if (user && user.status === AccountStatus.PENDING_VERIFICATION) {
        user.emailVerificationToken = randomToken();
        user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await user.save();
        await sendVerificationEmail(user.email, user.emailVerificationToken!);
      }

      res.json({ message: 'If an unverified account exists for that email, a new verification link has been sent.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/forgot-password
 */
authRouter.post(
  '/forgot-password',
  sensitiveLimiter,
  validate(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const user = await User.findOne({ email });

      if (user && user.status !== AccountStatus.DEACTIVATED) {
        user.passwordResetToken = randomToken();
        user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
        await user.save();
        await sendPasswordResetEmail(user.email, user.passwordResetToken!);
      }

      res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/reset-password
 */
authRouter.post(
  '/reset-password',
  sensitiveLimiter,
  validate(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password } = req.body;
      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      });

      if (!user) {
        throw httpError(400, 'Invalid or expired reset token.');
      }

      // `setPassword` hashes via argon2; the pre('save') hook only hashes when
      // `passwordHash` is modified, so use the method then save.
      await user.setPassword(password);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      res.json({ message: 'Password reset successful. You can now log in.' });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /auth/change-password
 */
authRouter.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user!.id);
      if (!user) {
        throw httpError(404, 'User not found.');
      }

      const match = await user.comparePassword(currentPassword);
      if (!match) {
        throw httpError(401, 'Current password is incorrect.');
      }

      await user.setPassword(newPassword);
      await user.save();

      res.json({ message: 'Password changed.' });
    } catch (err) {
      next(err);
    }
  }
);

export default authRouter;
