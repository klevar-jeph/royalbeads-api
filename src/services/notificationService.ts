// src/services/notificationService.ts
// Notification service – CRUD + read-state operations for user notifications.

import { Notification, NotificationType, INotification } from '../models/Notification';
import { NotificationDTO, NotificationListDTO } from '../types/dto';
import { Types } from 'mongoose';

function toDTO(n: INotification): NotificationDTO {
  return {
    id: n._id.toString(),
    type: n.type,
    title: n.title,
    message: n.message,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

export interface ListOptions {
  limit?: number;
  cursor?: string; // ISO date for cursor-based pagination (optional)
  unreadOnly?: boolean;
}

export const notificationService = {
  async list(userId: string | Types.ObjectId, opts: ListOptions = {}): Promise<NotificationListDTO> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
    const query: Record<string, unknown> = { userId };
    if (opts.unreadOnly) query.read = false;

    const docs = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    const total = await Notification.countDocuments({ userId });
    const unread = await Notification.countDocuments({ userId, read: false });

    return {
      items: docs.map(toDTO),
      total,
      unread,
    };
  },

  async markRead(userId: string, notificationId: string): Promise<NotificationDTO | null> {
    const doc = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { $set: { read: true } },
      { new: true }
    );
    return doc ? toDTO(doc) : null;
  },

  async markAllRead(userId: string): Promise<number> {
    const result = await Notification.updateMany(
      { userId, read: false },
      { $set: { read: true } }
    );
    return result.modifiedCount;
  },

  /**
   * Internal helper for future phases to create notifications. Not exposed via
   * a public route in Phase 3.
   */
  async create(input: {
    userId: string | Types.ObjectId;
    type: NotificationType;
    title: string;
    message: string;
  }): Promise<NotificationDTO> {
    const doc = await Notification.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
    });
    return toDTO(doc);
  },

  async unreadCount(userId: string | Types.ObjectId): Promise<number> {
    return Notification.countDocuments({ userId, read: false });
  },
};
