// src/models/RewardLedger.ts
// Feature-specific reward records connected to the common financial ledger infrastructure.
// Features: Lucky Draw, Red Envelope, Weekly Event.

import { Schema, model, Document, Types } from 'mongoose';

export enum RewardFeature {
  LUCKY_DRAW = 'LUCKY_DRAW',
  RED_ENVELOPE = 'RED_ENVELOPE',
  WEEKLY_EVENT = 'WEEKLY_EVENT',
}

export interface IRewardLedger extends Document {
  userId: Types.ObjectId;
  userName: string;
  feature: RewardFeature;
  rewardType: string; // 'CASH' | 'SPIN'
  amount: number;
  reference: string;
  transactionId?: Types.ObjectId;
  sourceRecordId?: string; // id of spin, claim, or event participation
  status: string; // 'CREDITED' | 'CONSUMED' | 'PENDING'
  meta?: Record<string, unknown>;
  createdAt: Date;
}

const RewardLedgerSchema = new Schema<IRewardLedger>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, required: true },
    feature: {
      type: String,
      enum: Object.values(RewardFeature),
      required: true,
      index: true,
    },
    rewardType: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    reference: { type: String, required: true, unique: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    sourceRecordId: { type: String },
    status: { type: String, default: 'CREDITED', index: true },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

RewardLedgerSchema.index({ userId: 1, createdAt: -1 });

export const RewardLedger = model<IRewardLedger>('RewardLedger', RewardLedgerSchema);
