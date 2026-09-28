// src/models/LuckyDrawPrize.ts
// Lucky Draw prize configuration in database.
// Uses weighted random selection server-side.

import { Schema, model, Document } from 'mongoose';

export interface ILuckyDrawPrize extends Document {
  label: string; // e.g. "₦1,000", "₦5,000", "₦100,000"
  amount: number; // Cash reward (whole Naira)
  weight: number; // Probability weight
  sortOrder: number;
  active: boolean;
  color?: string; // Display color on frontend wheel
  createdAt: Date;
  updatedAt: Date;
}

const LuckyDrawPrizeSchema = new Schema<ILuckyDrawPrize>(
  {
    label: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    weight: { type: Number, required: true, min: 1 },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true, index: true },
    color: { type: String, default: '#E5A93C' },
  },
  { timestamps: true }
);

export const LuckyDrawPrize = model<ILuckyDrawPrize>('LuckyDrawPrize', LuckyDrawPrizeSchema);
