// src/models/WeeklyEventParticipation.ts
// User participation and qualification status for Weekly Events.

import { Schema, model, Document, Types } from 'mongoose';

export interface IWeeklyEventParticipation extends Document {
  eventId: Types.ObjectId;
  userId: Types.ObjectId;
  currentReferrals: number;
  currentLevelRank: number;
  currentTeamMembers: number;
  qualified: boolean;
  rewardClaimed: boolean;
  rewardReference?: string;
  claimedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WeeklyEventParticipationSchema = new Schema<IWeeklyEventParticipation>(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'WeeklyEvent', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    currentReferrals: { type: Number, default: 0 },
    currentLevelRank: { type: Number, default: 0 },
    currentTeamMembers: { type: Number, default: 0 },
    qualified: { type: Boolean, default: false },
    rewardClaimed: { type: Boolean, default: false },
    rewardReference: { type: String },
    claimedAt: { type: Date },
  },
  { timestamps: true }
);

WeeklyEventParticipationSchema.index({ eventId: 1, userId: 1 }, { unique: true });

export const WeeklyEventParticipation = model<IWeeklyEventParticipation>(
  'WeeklyEventParticipation',
  WeeklyEventParticipationSchema
);
