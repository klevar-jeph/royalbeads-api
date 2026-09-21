// src/validation/wallet.ts
// Zod validation schemas for wallet/payment endpoints.

import { z } from 'zod';

export const depositSchema = z.object({
  body: z.object({
    amount: z
      .number({ invalid_type_error: 'Amount must be a number.' })
      .int('Amount must be a whole Naira amount.')
      .min(100, 'Minimum deposit is ₦100.'),
    note: z.string().trim().max(500).optional(),
  }),
});

export const withdrawalSchema = z.object({
  body: z.object({
    amount: z
      .number({ invalid_type_error: 'Amount must be a number.' })
      .int('Amount must be a whole Naira amount.')
      .min(1, 'Amount must be at least ₦1.'),
    bankName: z.string().trim().min(1, 'Bank name is required.').max(120),
    accountNumber: z.string().trim().min(1, 'Account number is required.').max(20),
    accountName: z.string().trim().min(1, 'Account name is required.').max(120),
  }),
});
