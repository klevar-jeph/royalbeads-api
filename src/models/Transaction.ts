// src/models/Transaction.ts
// Append-only wallet ledger. One document per balance movement.
//
// Types cover the full platform economy: task rewards, referral commissions,
// VIP purchases, deposits, withdrawals and manual admin adjustments. Deposits
// and withdrawals are only recorded when they affect the balance.

import { Schema, model, Document, Types } from 'mongoose';

export enum TransactionType {
  TASK_REWARD = 'TASK_REWARD',
  REFERRAL_COMMISSION = 'REFERRAL_COMMISSION',
  VIP_PURCHASE = 'VIP_PURCHASE',
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  ADJUSTMENT = 'ADJUSTMENT',
}

export interface ITransaction extends Document {
  userId: Types.ObjectId;
  type: TransactionType;
  /** Positive = credit, negative = debit (whole Naira). */
  amount: number;
  /** Balance in the wallet after this movement. */
  balanceAfter: number;
  description: string;
  /** Optional free-form context (gateway refs, admin notes, ids). */
  meta?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, trim: true, maxlength: 300 },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Inbox-style listing: newest first per user.
TransactionSchema.index({ userId: 1, createdAt: -1 });

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
