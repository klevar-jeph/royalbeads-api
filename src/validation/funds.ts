// src/validation/funds.ts
// Zod schemas for the Fund/Investment feature (admin CRUD + user investing).

import { z } from 'zod';

/** Accepts "YYYY-MM-DD" / ISO strings and normalises them to Date. */
const dateField = z
  .string()
  .trim()
  .min(1, 'Date is required.')
  .transform((value) => new Date(value))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date.');

const categoryField = z.enum(['SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM'], {
  errorMap: () => ({ message: 'Category must be SHORT_TERM, MEDIUM_TERM or LONG_TERM.' }),
});

const statusField = z.enum(['ACTIVE', 'SOLD_OUT', 'COMPLETED', 'INACTIVE'], {
  errorMap: () => ({ message: 'Status must be ACTIVE, SOLD_OUT, COMPLETED or INACTIVE.' }),
});

function refineDateRange<T extends { startDate?: Date; endDate?: Date }>(
  body: T,
  ctx: z.RefinementCtx
): void {
  if (body.startDate && body.endDate && body.endDate.getTime() <= body.startDate.getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'End/maturity date must be after the start date.',
    });
  }
}

const fundBodyShape = {
  name: z.string().trim().min(1, 'Fund name is required.').max(120),
  category: categoryField,
  amount: z.number().int('Amount must be a whole Naira amount.').min(1, 'Amount must be at least ₦1.'),
  durationDays: z.number().int('Duration must be whole days.').min(1, 'Duration must be at least 1 day.'),
  expectedReturn: z.string().trim().min(1, 'Expected return/benefit is required.').max(300),
  description: z.string().trim().max(1000).optional(),
  startDate: dateField,
  endDate: dateField,
  status: statusField.optional(),
};

/** POST /api/admin/funds — create a fund (status defaults to ACTIVE). */
export const createFundSchema = z.object({
  body: z
    .object(fundBodyShape)
    .superRefine((body, ctx) => refineDateRange(body, ctx)),
});

/** PATCH /api/admin/funds/:id — edit any subset of fund fields. */
export const updateFundSchema = z.object({
  body: z
    .object({
      name: fundBodyShape.name.optional(),
      category: categoryField.optional(),
      amount: fundBodyShape.amount.optional(),
      durationDays: fundBodyShape.durationDays.optional(),
      expectedReturn: fundBodyShape.expectedReturn.optional(),
      description: fundBodyShape.description.optional(),
      startDate: dateField.optional(),
      endDate: dateField.optional(),
      status: statusField.optional(),
    })
    .superRefine((body, ctx) => refineDateRange(body, ctx)),
});
