// src/models/SalaryPosition.ts
// Configuration for the 7 salary positions:
// Junior Assistant, Intermediate Assistant, Junior Supervisor, Intermediate Supervisor,
// Mid-Level Supervisor, Senior Supervisor, City Partner.

import { Schema, model, Document } from 'mongoose';

export interface ISalaryPosition extends Document {
  rank: number; // 1 to 7
  code: string; // 'JUNIOR_ASSISTANT', etc.
  title: string; // 'Junior Assistant', etc.
  monthlySalary: number; // e.g. 40_000
  totalMembersReq: number; // e.g. 10
  directReferralsReq: number; // e.g. 10
  aboveLevel1Req: number; // members at R2 or higher (R1 normalized to Level 1, does not count)
  retentionDirectReq: number; // Weekly direct referral requirement (default 1)
  retentionTeamReq: number; // Weekly team activity requirement
  gracePeriodDays: number; // Days in grace / at-risk period before final disqualification
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SalaryPositionSchema = new Schema<ISalaryPosition>(
  {
    rank: { type: Number, required: true, unique: true, index: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    monthlySalary: { type: Number, required: true, min: 0 },
    totalMembersReq: { type: Number, required: true, min: 0 },
    directReferralsReq: { type: Number, required: true, min: 0 },
    aboveLevel1Req: { type: Number, required: true, min: 0 },
    retentionDirectReq: { type: Number, default: 1, min: 0 },
    retentionTeamReq: { type: Number, default: 0, min: 0 },
    gracePeriodDays: { type: Number, default: 7, min: 0 },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

export const SalaryPosition = model<ISalaryPosition>('SalaryPosition', SalaryPositionSchema);
