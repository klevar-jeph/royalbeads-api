// src/models/LuckyDrawEntitlement.ts
// Auditable relationship between qualifying referral and spin entitlement.
// Prevents the same referral from awarding multiple spins.

import { Schema, model, Document, Types } from 'mongoose';

export enum EntitlementStatus {
  AWARDED = 'AWARDED',
  CONSUMED = 'CONSUMED',
}

export interface ILuckyDrawEntitlement extends Document {
  referrerId: Types.ObjectId;
  referredUserId: Types.ObjectId;
  conditionDescription: string;
  status: EntitlementStatus;
  awardedAt: Date;
  consumedAt?: Date;
  spinReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LuckyDrawEntitlementSchema = new Schema<ILuckyDrawEntitlement>(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    conditionDescription: { type: String, default: 'Qualifying Referral' },
    status: {
      type: String,
      enum: Object.values(EntitlementStatus),
      default: EntitlementStatus.AWARDED,
      index: true,
    },
    awardedAt: { type: Date, default: Date.now },
    consumedAt: { type: Date },
    spinReference: { type: String },
  },
  { timestamps: true }
);

// One spin entitlement per referred user
LuckyDrawEntitlementSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });

export const LuckyDrawEntitlement = model<ILuckyDrawEntitlement>(
  'LuckyDrawEntitlement',
  LuckyDrawEntitlementSchema
);
