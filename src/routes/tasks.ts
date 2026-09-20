// src/routes/tasks.ts
// Tasks & rewards endpoints. All require authentication.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { taskController } from '../controllers/taskController';

export const taskRouter = Router();

taskRouter.use(requireAuth);
taskRouter.use(apiLimiter);

/**
 * GET /api/tasks
 * Today's task list for the current user (VIP-gated, with completion state).
 */
taskRouter.get('/', taskController.listToday);

/**
 * GET /api/tasks/me/completions
 * The user's completion history.
 */
taskRouter.get('/me/completions', taskController.listCompletions);

/**
 * POST /api/tasks/:id/complete
 * Complete a task once now; credits the reward to the wallet.
 */
taskRouter.post('/:id/complete', taskController.complete);

export default taskRouter;
