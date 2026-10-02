// src/models/Fund.ts
// Fund/Investment catalogue — fully admin-configurable and deliberately
// separate from the task/reward economy. Users invest from their wallet
// balance; each investment is tracked in FundInvestment.

import { Schema, model, Document } from 'mongoose';

export enum FundCategory {
  SHORT_TERM = 'SHORT_TERM',
  MEDIUM_TERM = 'MEDIUM_TERM',
  LONG_TERM = 'LONG_TERM',
}

/**
 * ACTIVE     — open for investments.
 * SOLD_OUT   — visible to users but no new investments accepted.
 * COMPLETED  — finished/closed historical fund (visible, not purchasable).
 * INACTIVE   — deactivated by the admin; hidden from users entirely.
 */
export enum FundStatus {
  ACTIVE = 'ACTIVE',
  SOLD_OUT = 'SOLD_OUT',
  COMPLETED = 'COMPLETED',
  INACTIVE = 'INACTIVE',
}

export interface IFund extends Document {
  name: string;
  category: FundCategory;
  /** Whole-Naira amount required to invest. */
  amount: number;
  /** Duration in days (displayed alongside start/maturity dates). */
  durationDays: number;
  /** Admin-configured expected return/benefit text, e.g. "₦30,000 (10%)". */
  expectedReturn: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  status: FundStatus;
  createdAt: Date;
  updatedAt: Date;
}

const FundSchema = new Schema<IFund>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: Object.values(FundCategory), required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    durationDays: { type: Number, required: true, min: 1 },
    expectedReturn: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 1000 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(FundStatus), default: FundStatus.ACTIVE, index: true },
  },
  { timestamps: true }
);

FundSchema.index({ category: 1, status: 1, amount: 1 });

export const Fund = model<IFund>('Fund', FundSchema);