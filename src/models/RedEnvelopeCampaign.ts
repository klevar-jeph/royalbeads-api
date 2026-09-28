// src/models/RedEnvelopeCampaign.ts
// Red Envelope Campaign model.
// Guarantees: Distributed amount <= budget, Claims <= maxWinners.

import { Schema, model, Document, Types } from 'mongoose';

export interface IRedEnvelopeCampaign extends Document {
  title: string;
  claimCode: string;
  totalBudget: number;
  remainingBudget: number;
  maxWinners: number;
  remainingClaims: number;
  minAmount: number;
  maxAmount: number;
  isRandom: boolean; // Random distribution vs fixed equal distribution
  active: boolean;
  startDate: Date;
  endDate: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const RedEnvelopeCampaignSchema = new Schema<IRedEnvelopeCampaign>(
  {
    title: { type: String, required: true, trim: true },
    claimCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    totalBudget: { type: Number, required: true, min: 1 },
    remainingBudget: { type: Number, required: true, min: 0 },
    maxWinners: { type: Number, required: true, min: 1 },
    remainingClaims: { type: Number, required: true, min: 0 },
    minAmount: { type: Number, required: true, min: 1 },
    maxAmount: { type: Number, required: true, min: 1 },
    isRandom: { type: Boolean, default: true },
    active: { type: Boolean, default: true, index: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const RedEnvelopeCampaign = model<IRedEnvelopeCampaign>(
  'RedEnvelopeCampaign',
  RedEnvelopeCampaignSchema
);
