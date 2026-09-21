// src/models/Deposit.ts
// A deposit request made by a user.
//
// With PAYMENT_PROVIDER=manual the user pays by bank transfer and submits a
// request; an admin confirms the payment and the wallet is credited. Gateway
// providers (paystack/flutterwave) will create PENDING deposits from their
// webhooks using the same review flow.

import { Schema, model, Document, Types } from 'mongoose';

export enum DepositStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface IDeposit extends Document {
  userId: Types.ObjectId;
  amount: number;
  method: 'BANK_TRANSFER' | 'GATEWAY';
  status: DepositStatus;
  reference: string;
  /** User-submitted note, e.g. transfer sender name / bank. */
  note?: string;
  reviewedBy?: Types.ObjectId;
  reviewNote?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DepositSchema = new Schema<IDeposit>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 100 },
    method: {
      type: String,
      enum: ['BANK_TRANSFER', 'GATEWAY'],
      default: 'BANK_TRANSFER',
    },
    status: {
      type: String,
      enum: Object.values(DepositStatus),
      default: DepositStatus.PENDING,
      index: true,
    },
    reference: { type: String, required: true, unique: true },
    note: { type: String, trim: true, maxlength: 500 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

DepositSchema.index({ userId: 1, createdAt: -1 });
DepositSchema.index({ status: 1, createdAt: -1 });

export const Deposit = model<IDeposit>('Deposit', DepositSchema);
