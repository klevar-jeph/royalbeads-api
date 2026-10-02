// src/models/FundInvestment.ts
// A user's stake in a fund. Created when the user invests (wallet debit) and
// kept connected to both the user and the fund so the user, the admin dashboard
// and the "My Fund" records all read the same source of truth.

import { Schema, model, Document, Types } from 'mongoose';
import { FundCategory } from './Fund';

/**
 * ACTIVE   — invested, not yet matured.
 * MATURED  — maturity/end date reached.
 */
export enum FundInvestmentStatus {
  ACTIVE = 'ACTIVE',
  MATURED = 'MATURED',
}

export interface IFundInvestment extends Document {
  userId: Types.ObjectId;
  fundId: Types.ObjectId;
  /** Snapshot so records stay meaningful if the fund is later edited/deleted. */
  fundName: string;
  category: FundCategory;
  amount: number;
  expectedReturn: string;
  startDate: Date;
  maturesAt: Date;
  status: FundInvestmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const FundInvestmentSchema = new Schema<IFundInvestment>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fundId: { type: Schema.Types.ObjectId, ref: 'Fund', required: true, index: true },
    fundName: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: Object.values(FundCategory), required: true },
    amount: { type: Number, required: true, min: 1 },
    expectedReturn: { type: String, required: true, trim: true, maxlength: 300 },
    startDate: { type: Date, required: true },
    maturesAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(FundInvestmentStatus),
      default: FundInvestmentStatus.ACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

// Inbox-style listing: newest first per user; admin investor views per fund.
FundInvestmentSchema.index({ userId: 1, createdAt: -1 });
FundInvestmentSchema.index({ fundId: 1, createdAt: -1 });

export const FundInvestment = model<IFundInvestment>('FundInvestment', FundInvestmentSchema);