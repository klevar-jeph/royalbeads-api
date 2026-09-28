// src/models/TaskScheduleOverride.ts
// Date overrides for the task schedule engine (holidays, audit days, special enabled/disabled dates).

import { Schema, model, Document } from 'mongoose';

export enum ScheduleOverrideType {
  HOLIDAY = 'HOLIDAY',
  AUDIT_DAY = 'AUDIT_DAY',
  FORCE_ENABLE = 'FORCE_ENABLE',
  FORCE_DISABLE = 'FORCE_DISABLE',
}

export interface ITaskScheduleOverride extends Document {
  date: string; // YYYY-MM-DD
  overrideType: ScheduleOverrideType;
  reason: string;
  enabled: boolean;
  applicableLevels?: string[]; // Empty means all levels
  createdAt: Date;
  updatedAt: Date;
}

const TaskScheduleOverrideSchema = new Schema<ITaskScheduleOverride>(
  {
    date: { type: String, required: true, index: true },
    overrideType: {
      type: String,
      enum: Object.values(ScheduleOverrideType),
      required: true,
    },
    reason: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    applicableLevels: { type: [String], default: [] },
  },
  { timestamps: true }
);

TaskScheduleOverrideSchema.index({ date: 1, overrideType: 1 }, { unique: true });

export const TaskScheduleOverride = model<ITaskScheduleOverride>(
  'TaskScheduleOverride',
  TaskScheduleOverrideSchema
);
