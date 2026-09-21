// src/routes/referrals.ts
// Referral endpoints for the authenticated user.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { referralService } from '../services/referralService';

export const referralRouter = Router();

referralRouter.use(requireAuth);
referralRouter.use(apiLimiter);

/**
 * GET /api/referrals
 * The user's referral code, share link, commission rate, downlines and earnings.
 */
referralRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await referralService.getSummary(req.user!.id);
    if (!summary) return res.status(404).json({ message: 'User not found.' });
    res.json({ referrals: summary });
  } catch (err) {
    next(err);
  }
});

export default referralRouter;
