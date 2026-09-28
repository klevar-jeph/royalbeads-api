// src/models/SalaryLedger.ts
// Dedicated Salary Ledger.
// States: ACCUMULATING -> READY_TO_CLAIM -> CLAIMED
// Daily rate = Monthly Salary / Actual Days in Month.

import { Schema, model, Document, Types } from 'mongoose';

export enum SalaryStatus {
  ACCUMULATING = 'ACCUMULATING',
  READY_TO_CLAIM = 'READY_TO_CLAIM',
  CLAIMED = 'CLAIMED',
}

export interface ISalaryLedger extends Document {
  userId: Types.ObjectId;
  positionId: Types.ObjectId;
  positionCode: string;
  positionTitle: string;
  salaryMonth: string; // YYYY-MM
  qualificationDate: Date;
  monthlySalary: number;
  daysInMonth: number;
  qualifyingDays: number;
  dailyRate: number;
  accumulatedAmount: number;
  finalAmount: number;
  status: SalaryStatus;
  claimDate?: Date;
  claimReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SalaryLedgerSchema = new Schema<ISalaryLedger>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    positionId: { type: Schema.Types.ObjectId, ref: 'SalaryPosition', required: true },
    positionCode: { type: String, required: true },
    positionTitle: { type: String, required: true },
    salaryMonth: { type: String, required: true, index: true }, // '2026-09'
    qualificationDate: { type: Date, required: true },
    monthlySalary: { type: Number, required: true, min: 0 },
    daysInMonth: { type: Number, required: true, min: 28, max: 31 },
    qualifyingDays: { type: Number, required: true, min: 0, max: 31 },
    dailyRate: { type: Number, required: true, min: 0 },
    accumulatedAmount: { type: Number, required: true, min: 0 },
    finalAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(SalaryStatus),
      default: SalaryStatus.ACCUMULATING,
      index: true,
    },
    claimDate: { type: Date },
    claimReference: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

// One salary record per user per month
SalaryLedgerSchema.index({ userId: 1, salaryMonth: 1 }, { unique: true });

export const SalaryLedger = model<ISalaryLedger>('SalaryLedger', SalaryLedgerSchema);
