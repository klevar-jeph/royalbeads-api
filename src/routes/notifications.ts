// src/routes/notifications.ts
// Notification endpoints.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { notificationController } from '../controllers/notificationController';

export const notificationRouter = Router();

notificationRouter.use(requireAuth);
notificationRouter.use(apiLimiter);

/**
 * GET /api/notifications?limit=50&unreadOnly=true
 */
notificationRouter.get('/', notificationController.list);

/**
 * PATCH /api/notifications/:id/read
 */
notificationRouter.patch('/:id/read', notificationController.markRead);

/**
 * PATCH /api/notifications/read-all
 */
notificationRouter.patch('/read-all', notificationController.markAllRead);

export default notificationRouter;
