// src/validation/vip.ts
// Zod validation schemas for VIP endpoints.

import { z } from 'zod';
import { VIP_LEVELS } from '../config/vipLevels';

/** Valid membership codes come from the single level configuration source. */
const LEVEL_CODES = VIP_LEVELS.map((level) => level.code);

export const upgradeRequestSchema = z.object({
  body: z.object({
    levelCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => LEVEL_CODES.includes(code), {
        message: `Level code must be one of ${LEVEL_CODES.join(', ')}.`,
      }),
  }),
});

export const reviewPurchaseSchema = z.object({
  body: z.object({
    decision: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  }),
});
