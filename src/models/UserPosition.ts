// src/models/UserPosition.ts
// Active and historical positions for users.
// Status: ACTIVE | REQUIREMENT_IN_PROGRESS | AT_RISK | DISQUALIFIED

import { Schema, model, Document, Types } from 'mongoose';

export enum PositionStatus {
  ACTIVE = 'ACTIVE',
  REQUIREMENT_IN_PROGRESS = 'REQUIREMENT_IN_PROGRESS',
  AT_RISK = 'AT_RISK',
  DISQUALIFIED = 'DISQUALIFIED',
}

export interface IUserPosition extends Document {
  userId: Types.ObjectId;
  positionId: Types.ObjectId;
  positionCode: string;
  positionTitle: string;
  status: PositionStatus;
  effectiveDate: Date;
  monthlySalary: number;
  // Qualification snapshot
  qualifyingTotalMembers: number;
  qualifyingDirectReferrals: number;
  qualifyingAboveLevel1: number;
  // Disqualification details
  disqualifiedAt?: Date;
  disqualificationReason?: string;
  failedRequirement?: string;
  // Restoration details
  restoredAt?: Date;
  restoredBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const UserPositionSchema = new Schema<IUserPosition>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    positionId: { type: Schema.Types.ObjectId, ref: 'SalaryPosition', required: true },
    positionCode: { type: String, required: true },
    positionTitle: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(PositionStatus),
      default: PositionStatus.ACTIVE,
      index: true,
    },
    effectiveDate: { type: Date, required: true },
    monthlySalary: { type: Number, required: true, min: 0 },
    qualifyingTotalMembers: { type: Number, default: 0 },
    qualifyingDirectReferrals: { type: Number, default: 0 },
    qualifyingAboveLevel1: { type: Number, default: 0 },
    disqualifiedAt: { type: Date },
    disqualificationReason: { type: String },
    failedRequirement: { type: String },
    restoredAt: { type: Date },
    restoredBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// At most one ACTIVE / REQUIREMENT_IN_PROGRESS / AT_RISK position per user
UserPositionSchema.index(
  { userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] } } }
);

export const UserPosition = model<IUserPosition>('UserPosition', UserPositionSchema);
