// src/controllers/taskController.ts
// Thin HTTP controllers for task endpoints.

import { Request, Response, NextFunction } from 'express';
import { taskService } from '../services/taskService';
import { walletService } from '../services/walletService';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const taskController = {
  async listToday(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const list = await taskService.listForUser(req.user!.id);
      res.json(list);
    } catch (err) {
      next(err);
    }
  },

  async listCompletions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 30;
      const completions = await taskService.listCompletions(
        req.user!.id,
        Number.isNaN(limit) ? 30 : limit
      );
      res.json({ completions });
    } catch (err) {
      next(err);
    }
  },

  async complete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { completion, reward } = await taskService.complete(req.user!.id, req.params.id);
      res.status(201).json({
        completion: {
          id: completion._id.toString(),
          taskKey: completion.taskKey,
          taskTitle: completion.taskTitle,
          day: completion.day,
          reward: completion.reward,
          createdAt: completion.createdAt.toISOString(),
        },
        reward,
      });
    } catch (err) {
      next(err);
    }
  },

  async getWalletOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const overview = await walletService.getOverview(req.user!.id);
      if (!overview) throw httpError(404, 'User not found.');
      res.json({
        wallet: {
          availableBalance: overview.wallet.availableBalance,
          totalEarned: overview.wallet.totalEarned,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
