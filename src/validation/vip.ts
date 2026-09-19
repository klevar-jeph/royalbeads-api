// src/validation/vip.ts
// Zod validation schemas for VIP endpoints.

import { z } from 'zod';

export const upgradeRequestSchema = z.object({
  body: z.object({
    levelCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^R[0-9]$/, 'Level code must be one of R0–R9.'),
  }),
});

export const reviewPurchaseSchema = z.object({
  body: z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  }),
});
