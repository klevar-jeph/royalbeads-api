// src/models/Notification.ts
// User-facing notification documents.
//
// One document per notification per user. Future phases (wallet, tasks, VIP)
// will insert notifications through the NotificationService rather than
// writing to this collection directly from routes.

import { Schema, model, Document, Types } from 'mongoose';

export enum NotificationType {
  SYSTEM = 'SYSTEM',
  ACCOUNT = 'ACCOUNT',
  SECURITY = 'SECURITY',
  REFERRAL = 'REFERRAL',
  WALLET = 'WALLET',
  TASK = 'TASK',
  VIP = 'VIP',
}

export interface INotification extends Document {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: Object.values(NotificationType),
      default: NotificationType.SYSTEM,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Compound index for the "inbox" query (newest first, filtered by user).
NotificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);
