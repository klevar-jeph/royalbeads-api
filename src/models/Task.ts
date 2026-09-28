// src/models/Task.ts
// Task definitions for the daily tasks & rewards engine.
//
// Definitions are platform data so reward amounts and availability rules can
// be tuned without code changes. Supports assignment to specific levels.

import { Schema, model, Document } from 'mongoose';

export interface ITask extends Document {
  /** Stable machine key, e.g. "watch-promo". */
  key: string;
  title: string;
  description: string;
  /** Reward credited on completion (whole Naira). */
  reward: number;
  /** Minimum VIP tier required to see/complete this task. */
  minVipTier: number;
  /** Specific levels eligible for this task. E.g. ['R1', 'R2', 'R5'] */
  assignedLevels: string[];
  /** Daily completion limit (1 = once per day). */
  dailyLimit: number;
  active: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskSchema = new Schema<ITask>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    reward: { type: Number, required: true, min: 0 },
    minVipTier: { type: Number, default: 0, min: 0, max: 10 },
    assignedLevels: { type: [String], default: [] },
    dailyLimit: { type: Number, default: 1, min: 1, max: 50 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Task = model<ITask>('Task', TaskSchema);

