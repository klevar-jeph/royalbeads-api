// src/models/VipPurchase.ts
// A VIP upgrade request made by a user.
//
// Purchases are created as PENDING and are activated (or rejected) by an
// administrator after payment confirmation. This keeps payment handling
// (bank transfer or gateway, Phase 6) decoupled from the VIP progression
// logic.

import { Schema, model, Document, Types } from 'mongoose';

export enum VipPurchaseStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export interface IVipPurchase extends Document {
  userId: Types.ObjectId;
  levelTier: number;
  levelCode: string;
  levelName: string;
  amount: number;
  status: VipPurchaseStatus;
  reviewedBy?: Types.ObjectId;
  reviewNote?: string;
  reviewedAt?: Date;
  paystackReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const VipPurchaseSchema = new Schema<IVipPurchase>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    levelTier: { type: Number, required: true, min: 0, max: 10 },
    levelCode: { type: String, required: true },
    levelName: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(VipPurchaseStatus),
      default: VipPurchaseStatus.PENDING,
      index: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
    paystackReference: { type: String, trim: true },
  },
  { timestamps: true }
);

// One pending purchase per user at a time (partial index).
VipPurchaseSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: VipPurchaseStatus.PENDING } }
);

export const VipPurchase = model<IVipPurchase>('VipPurchase', VipPurchaseSchema);
