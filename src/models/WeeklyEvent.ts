// src/models/WeeklyEvent.ts
// Weekly Events reward engine.
// Supports multi-condition qualification and rewards (Cash or Lucky Draw spins).

import { Schema, model, Document, Types } from 'mongoose';

export enum EventRewardType {
  CASH = 'CASH',
  LUCKY_DRAW_SPINS = 'LUCKY_DRAW_SPINS',
}

export interface IWeeklyEvent extends Document {
  title: string;
  description: string;
  startDate: Date;
  endDate: Date;
  // Conditions
  requiredReferrals: number;
  requiredLevelRank?: number; // Minimum level rank required
  requiredTeamMembers?: number; // Total team downlines required
  // Reward details
  rewardType: EventRewardType;
  rewardAmount: number; // Cash amount in Naira or count of Lucky Draw spins
  maxWinners: number;
  winnersCount: number;
  active: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const WeeklyEventSchema = new Schema<IWeeklyEvent>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    requiredReferrals: { type: Number, default: 0, min: 0 },
    requiredLevelRank: { type: Number, default: 0, min: 0 },
    requiredTeamMembers: { type: Number, default: 0, min: 0 },
    rewardType: {
      type: String,
      enum: Object.values(EventRewardType),
      default: EventRewardType.CASH,
    },
    rewardAmount: { type: Number, required: true, min: 1 },
    maxWinners: { type: Number, required: true, min: 1 },
    winnersCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const WeeklyEvent = model<IWeeklyEvent>('WeeklyEvent', WeeklyEventSchema);
