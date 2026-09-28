// src/routes/levels.ts
// Membership level catalogue for authenticated users.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { levelService } from '../services/levelService';
import { User } from '../models/User';

export const levelRouter = Router();

levelRouter.use(requireAuth);
levelRouter.use(apiLimiter);

/**
 * GET /api/levels
 * The full Intern → Master hierarchy with each level's configured capacity,
 * reward, daily earning and current accessibility (open/locked/temporary).
 */
levelRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [levels, user] = await Promise.all([
      levelService.listLevels(),
      User.findById(req.user!.id).select('vipLevel'),
    ]);
    const userTier = user?.vipLevel ?? 0;

    res.json({
      levels: levels.map((level) => ({
        id: level._id.toString(),
        code: level.code,
        name: level.name,
        rank: level.rank,
        status: level.status,
        tasksPerDay: level.tasksPerDay,
        rewardPerTask: level.rewardPerTask,
        dailyEarning: level.dailyEarning,
        investment: level.investment,
        description: level.description,
        temporaryOpen: level.temporaryOpen,
        accessible: levelService.isLevelAccessible(level),
        isUserLevel: level.rank === userTier,
      })),
      userRank: userTier,
    });
  } catch (err) {
    next(err);
  }
});

export default levelRouter;
