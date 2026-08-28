// src/validation/auth.ts
// Zod validation schemas for all authentication routes.
//
// Each schema is exported individually so handlers can compose them, and a
// `validate` factory is provided to turn a schema into Express middleware.

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// --- Field rules -----------------------------------------------------------

const emailField = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .email('A valid email address is required.')
  .max(254, 'Email must be 254 characters or fewer.')
  .toLowerCase();

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be 128 characters or fewer.')
  .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter.')
  .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter.')
  .refine((v) => /\d/.test(v), 'Password must contain a number.');

const tokenField = z.string().trim().min(1, 'Token is required.');

// --- Schemas ---------------------------------------------------------------

export const registerSchema = z.object({
  body: z.object({
    fullName: z
      .string()
      .trim()
      .min(1, 'Full name is required.')
      .max(80, 'Full name must be 80 characters or fewer.'),
    email: emailField,
    phone: z
      .string()
      .trim()
      .max(24, 'Phone must be 24 characters or fewer.')
      .optional(),
    password: passwordField,
    // Optional referral code – validated loosely; existence checked in handler.
    referralCode: z.string().trim().max(32).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailField,
    password: z.string().min(1, 'Password is required.'),
  }),
});

export const refreshSchema = z.object({
  // Refresh tokens travel via HTTP-only cookie, but we also allow a body field
  // for non-browser clients.
  body: z
    .object({
      refreshToken: z.string().optional(),
    })
    .optional(),
});

export const emailVerificationSchema = z.object({
  body: z.object({
    token: tokenField,
  }),
});

export const resendVerificationSchema = z.object({
  body: z.object({
    email: emailField,
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: emailField,
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: tokenField,
    password: passwordField,
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: passwordField,
  }),
});

export type AuthSchemas = {
  register: typeof registerSchema;
  login: typeof loginSchema;
  refresh: typeof refreshSchema;
  verifyEmail: typeof emailVerificationSchema;
  resendVerification: typeof resendVerificationSchema;
  forgotPassword: typeof forgotPasswordSchema;
  resetPassword: typeof resetPasswordSchema;
  changePassword: typeof changePasswordSchema;
};

// --- Middleware factory ----------------------------------------------------

type RequestPart = 'body' | 'query' | 'params';

/**
 * Validate the given `part` of the request against a Zod schema.
 *
 * On failure responds with 422 and the flattened error object.
 */
export function validate<T extends ZodSchema<any>>(
  schema: T,
  part: RequestPart = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const target = req[part];
    const result = schema.safeParse({ [part]: target });
    if (!result.success) {
      res.status(422).json({
        error: 'ValidationError',
        message: 'Validation failed.',
        details: result.error.flatten(),
      });
      return;
    }
    // Replace with the parsed (coerced/trimmed) value.
    (req as any)[part] = (result.data as any)[part];
    next();
  };
}
