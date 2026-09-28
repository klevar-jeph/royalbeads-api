// src/models/JobApplication.ts
// Job application lifecycle:
// PENDING_REQUIREMENTS -> ELIGIBLE_TO_APPLY -> UNDER_REVIEW -> APPROVED / REJECTED (or WITHDRAWN)

import { Schema, model, Document, Types } from 'mongoose';

export enum ApplicationStatus {
  PENDING_REQUIREMENTS = 'PENDING_REQUIREMENTS',
  ELIGIBLE_TO_APPLY = 'ELIGIBLE_TO_APPLY',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export interface IJobApplication extends Document {
  userId: Types.ObjectId;
  positionId: Types.ObjectId;
  positionCode: string;
  positionTitle: string;
  status: ApplicationStatus;
  // Snapshot of qualifications at time of application / review
  snapshotTotalMembers: number;
  snapshotDirectReferrals: number;
  snapshotAboveLevel1: number;
  reviewedBy?: Types.ObjectId;
  reviewRemarks?: string;
  reviewedAt?: Date;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const JobApplicationSchema = new Schema<IJobApplication>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    positionId: { type: Schema.Types.ObjectId, ref: 'SalaryPosition', required: true },
    positionCode: { type: String, required: true },
    positionTitle: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(ApplicationStatus),
      default: ApplicationStatus.UNDER_REVIEW,
      index: true,
    },
    snapshotTotalMembers: { type: Number, default: 0 },
    snapshotDirectReferrals: { type: Number, default: 0 },
    snapshotAboveLevel1: { type: Number, default: 0 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewRemarks: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Prevent multiple pending/under_review applications for the same position by same user
JobApplicationSchema.index(
  { userId: 1, positionId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: ApplicationStatus.UNDER_REVIEW } }
);

export const JobApplication = model<IJobApplication>('JobApplication', JobApplicationSchema);
