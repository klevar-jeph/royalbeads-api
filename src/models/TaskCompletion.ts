// src/models/TaskCompletion.ts
// A completed task by a user on a specific UTC day.
//
// The compound unique index (userId + taskKey + day) is the anti-double-claim
// guard enforced at the storage level; concurrent attempts cannot both insert.

import { Schema, model, Document, Types } from 'mongoose';

export interface ITaskCompletion extends Document {
  userId: Types.ObjectId;
  taskKey: string;
  taskTitle: string;
  /** UTC day bucket, format YYYY-MM-DD. */
  day: string;
  /** Reward credited (whole Naira). */
  reward: number;
  createdAt: Date;
  updatedAt: Date;
}

const TaskCompletionSchema = new Schema<ITaskCompletion>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    taskKey: { type: String, required: true },
    taskTitle: { type: String, required: true },
    day: { type: String, required: true },
    reward: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

TaskCompletionSchema.index({ userId: 1, taskKey: 1, day: 1 }, { unique: true });
TaskCompletionSchema.index({ userId: 1, day: 1, createdAt: -1 });

export const TaskCompletion = model<ITaskCompletion>('TaskCompletion', TaskCompletionSchema);
