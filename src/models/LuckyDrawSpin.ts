// src/models/LuckyDrawSpin.ts
// Auditable log of every Lucky Draw spin.

import { Schema, model, Document, Types } from 'mongoose';

export interface ILuckyDrawSpin extends Document {
  userId: Types.ObjectId;
  reference: string;
  prizeId: Types.ObjectId;
  prizeLabel: string;
  prizeAmount: number;
  entitlementId?: Types.ObjectId;
  createdAt: Date;
}

const LuckyDrawSpinSchema = new Schema<ILuckyDrawSpin>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reference: { type: String, required: true, unique: true },
    prizeId: { type: Schema.Types.ObjectId, ref: 'LuckyDrawPrize', required: true },
    prizeLabel: { type: String, required: true },
    prizeAmount: { type: Number, required: true, min: 0 },
    entitlementId: { type: Schema.Types.ObjectId, ref: 'LuckyDrawEntitlement' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LuckyDrawSpinSchema.index({ userId: 1, createdAt: -1 });

export const LuckyDrawSpin = model<ILuckyDrawSpin>('LuckyDrawSpin', LuckyDrawSpinSchema);
