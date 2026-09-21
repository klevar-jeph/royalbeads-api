// src/models/Withdrawal.ts
// A withdrawal request made by a user.
//
// On approval the wallet is debited immediately (the request is then PAID
// once the transfer is confirmed externally, or APPROVED → PAID by an admin).
// Balance is never locked; the debit guard in walletService prevents
// overdraft at approval time.

import { Schema, model, Document, Types } from 'mongoose';

export enum WithdrawalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  REJECTED = 'REJECTED',
}

export interface IWithdrawal extends Document {
  userId: Types.ObjectId;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: WithdrawalStatus;
  reference: string;
  reviewedBy?: Types.ObjectId;
  reviewNote?: string;
  reviewedAt?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WithdrawalSchema = new Schema<IWithdrawal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    bankName: { type: String, required: true, trim: true, maxlength: 120 },
    accountNumber: { type: String, required: true, trim: true, maxlength: 20 },
    accountName: { type: String, required: true, trim: true, maxlength: 120 },
    status: {
      type: String,
      enum: Object.values(WithdrawalStatus),
      default: WithdrawalStatus.PENDING,
      index: true,
    },
    reference: { type: String, required: true, unique: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

WithdrawalSchema.index({ userId: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });

export const Withdrawal = model<IWithdrawal>('Withdrawal', WithdrawalSchema);
