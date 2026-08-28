// src/controllers/notificationController.ts
// Thin HTTP controllers for notification endpoints.

import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../services/notificationService';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const notificationController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const unreadOnly = req.query.unreadOnly === 'true';
      const result = await notificationService.list(req.user!.id, { limit, unreadOnly });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const item = await notificationService.markRead(req.user!.id, id);
      if (!item) throw httpError(404, 'Notification not found.');
      res.json({ notification: item });
    } catch (err) {
      next(err);
    }
  },

  async markAllRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const modified = await notificationService.markAllRead(req.user!.id);
      res.json({ modified });
    } catch (err) {
      next(err);
    }
  },
};
