// src/models/RedEnvelopeClaim.ts
// Red Envelope Claim model.
// Prevents duplicate claims per user per campaign.

import { Schema, model, Document, Types } from 'mongoose';

export interface IRedEnvelopeClaim extends Document {
  campaignId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  reference: string;
  claimedAt: Date;
}

const RedEnvelopeClaimSchema = new Schema<IRedEnvelopeClaim>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'RedEnvelopeCampaign', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    reference: { type: String, required: true, unique: true },
    claimedAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'claimedAt', updatedAt: false } }
);

// One claim per user per campaign
RedEnvelopeClaimSchema.index({ campaignId: 1, userId: 1 }, { unique: true });

export const RedEnvelopeClaim = model<IRedEnvelopeClaim>('RedEnvelopeClaim', RedEnvelopeClaimSchema);
