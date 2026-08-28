// src/validation/user.ts
// Zod validation schemas for user profile and settings endpoints.

import { z } from 'zod';

const fullNameField = z
  .string()
  .trim()
  .min(1, 'Full name is required.')
  .max(80, 'Full name must be 80 characters or fewer.');

const phoneField = z
  .string()
  .trim()
  .max(24, 'Phone must be 24 characters or fewer.')
  .optional()
  .or(z.literal(''));

const avatarUrlField = z
  .string()
  .trim()
  .max(2048, 'Avatar URL is too long.')
  .url('Avatar must be a valid URL.')
  .optional()
  .or(z.literal(''));

export const updateProfileSchema = z.object({
  body: z.object({
    fullName: fullNameField.optional(),
    phone: phoneField.optional(),
    avatarUrl: avatarUrlField.optional(),
  }),
});

export const updatePreferencesSchema = z.object({
  body: z.object({
    email: z.boolean().optional(),
    system: z.boolean().optional(),
    marketing: z.boolean().optional(),
  }),
});

// Body for the change-password route (also lives on auth router, but a
// security-focused schema is kept here for reuse).
export const changePasswordSchemaUser = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128, 'Password must be 128 characters or fewer.')
      .refine((v) => /[A-Z]/.test(v), 'Password must contain an uppercase letter.')
      .refine((v) => /[a-z]/.test(v), 'Password must contain a lowercase letter.')
      .refine((v) => /\d/.test(v), 'Password must contain a number.'),
  }),
});
