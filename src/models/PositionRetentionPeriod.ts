// src/models/PositionRetentionPeriod.ts
// Weekly retention evaluation records for user positions.

import { Schema, model, Document, Types } from 'mongoose';
import { PositionStatus } from './UserPosition';

export interface IPositionRetentionPeriod extends Document {
  userPositionId: Types.ObjectId;
  userId: Types.ObjectId;
  positionCode: string;
  weekStart: Date;
  weekEnd: Date;
  requiredDirectReferrals: number;
  actualDirectReferrals: number;
  requiredTeamActivity: number;
  actualTeamActivity: number;
  status: PositionStatus;
  evaluatedAt: Date;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PositionRetentionPeriodSchema = new Schema<IPositionRetentionPeriod>(
  {
    userPositionId: { type: Schema.Types.ObjectId, ref: 'UserPosition', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    positionCode: { type: String, required: true },
    weekStart: { type: Date, required: true },
    weekEnd: { type: Date, required: true },
    requiredDirectReferrals: { type: Number, required: true, default: 1 },
    actualDirectReferrals: { type: Number, required: true, default: 0 },
    requiredTeamActivity: { type: Number, required: true, default: 0 },
    actualTeamActivity: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: Object.values(PositionStatus),
      required: true,
      default: PositionStatus.ACTIVE,
    },
    evaluatedAt: { type: Date, default: Date.now },
    reason: { type: String },
  },
  { timestamps: true }
);

PositionRetentionPeriodSchema.index({ userPositionId: 1, weekStart: 1 }, { unique: true });

export const PositionRetentionPeriod = model<IPositionRetentionPeriod>(
  'PositionRetentionPeriod',
  PositionRetentionPeriodSchema
);
