// src/models/LevelConfig.ts
// Database-backed level configuration.
// Hierarchy: Intern -> R1 -> R2 -> R3 -> R4 -> R5 -> R6 -> R7 -> R8 -> R9 -> Master
// Initial status: OPEN: R1, R2, R3; LOCKED: R4..R9, Master; Intern configurable.

import { Schema, model, Document } from 'mongoose';

export enum LevelStatus {
  OPEN = 'OPEN',
  LOCKED = 'LOCKED',
}

export interface ILevelConfig extends Document {
  code: string; // 'INTERN', 'R1', 'R2', ... 'MASTER'
  name: string; // 'Intern', 'R1', ... 'Master'
  rank: number; // 0 for INTERN, 1 for R1, ... 10 for MASTER
  status: LevelStatus;
  tasksPerDay: number;
  rewardPerTask: number;
  dailyEarning: number; // Can be tasksPerDay * rewardPerTask or custom configured
  investment: number;
  description: string;
  // Temporary opening settings
  temporaryOpen?: boolean;
  temporaryOpenStart?: Date;
  temporaryOpenEnd?: Date;
  // Eligibility / access rules
  minDirectReferrals?: number;
  minTotalTeam?: number;
  createdAt: Date;
  updatedAt: Date;
}

const LevelConfigSchema = new Schema<ILevelConfig>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    rank: { type: Number, required: true, unique: true },
    status: {
      type: String,
      enum: Object.values(LevelStatus),
      default: LevelStatus.LOCKED,
      index: true,
    },
    tasksPerDay: { type: Number, required: true, min: 0 },
    rewardPerTask: { type: Number, required: true, min: 0 },
    dailyEarning: { type: Number, required: true, min: 0 },
    investment: { type: Number, default: 0, min: 0 },
    description: { type: String, default: '' },
    temporaryOpen: { type: Boolean, default: false },
    temporaryOpenStart: { type: Date },
    temporaryOpenEnd: { type: Date },
    minDirectReferrals: { type: Number, default: 0 },
    minTotalTeam: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const LevelConfig = model<ILevelConfig>('LevelConfig', LevelConfigSchema);

