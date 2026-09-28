// src/routes/rewards.ts
// Lucky Draw, Red Envelope and Weekly Events (independent reward engines).

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { luckyDrawService } from '../services/luckyDrawService';
import { redEnvelopeService } from '../services/redEnvelopeService';
import { weeklyEventService } from '../services/weeklyEventService';
import { systemSettingService } from '../services/systemSettingService';
import { LuckyDrawEntitlement } from '../models/LuckyDrawEntitlement';
import { RewardLedger } from '../models/RewardLedger';

export const rewardsRouter = Router();

rewardsRouter.use(requireAuth);
rewardsRouter.use(apiLimiter);

// --- Lucky Draw -------------------------------------------------------------

/** GET /api/rewards/lucky-draw — spins, prize pool, spin history. */
rewardsRouter.get('/lucky-draw', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await luckyDrawService.getOverview(req.user!.id));
  } catch (err) {
    next(err);
  }
});

/** POST /api/rewards/lucky-draw/spin — server-authoritative spin. */
rewardsRouter.post('/lucky-draw/spin', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await luckyDrawService.spin(req.user!.id);
    res.json({
      message: `You won ${result.prize.label}!`,
      prize: {
        id: result.prize._id.toString(),
        label: result.prize.label,
        amount: result.prize.amount,
        color: result.prize.color,
      },
      reference: result.reference,
      spinId: result.spinId,
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/rewards/lucky-draw/entitlements — referral → spin audit trail. */
rewardsRouter.get(
  '/lucky-draw/entitlements',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entitlements = await LuckyDrawEntitlement.find({ referrerId: req.user!.id })
        .populate('referredUserId', 'fullName email')
        .sort({ awardedAt: -1 });
      res.json({ entitlements });
    } catch (err) {
      next(err);
    }
  }
);

// --- Red Envelope -----------------------------------------------------------

/** POST /api/rewards/red-envelope/claim — claim with a campaign code. */
rewardsRouter.post(
  '/red-envelope/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = req.body ?? {};
      if (!code || typeof code !== 'string') {
        res.status(422).json({ message: 'A Red Envelope claim code is required.' });
        return;
      }
      const claim = await redEnvelopeService.claim(req.user!.id, code);
      res.status(201).json({
        message: `You claimed ₦${claim.amount.toLocaleString()}!`,
        claim,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/rewards/red-envelope/claims — the user's claim history. */
rewardsRouter.get(
  '/red-envelope/claims',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ claims: await redEnvelopeService.listUserClaims(req.user!.id) });
    } catch (err) {
      next(err);
    }
  }
);

// --- Weekly Events ----------------------------------------------------------

/** GET /api/rewards/weekly-events — active events with live progress. */
rewardsRouter.get('/weekly-events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await weeklyEventService.listActiveEvents();
    // Evaluate against today's records so progress is always current (the
    // system never asks users to submit proof for known activity).
    const enriched = [];
    for (const { event } of entries) {
      const { participation } = await weeklyEventService.evaluateUserParticipation(
        req.user!.id,
        event._id.toString()
      );
      enriched.push({ event, participation });
    }
    res.json({
      events: enriched.map(({ event, participation }) => ({
        id: event._id.toString(),
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        requiredReferrals: event.requiredReferrals,
        requiredLevelRank: event.requiredLevelRank,
        requiredTeamMembers: event.requiredTeamMembers,
        rewardType: event.rewardType,
        rewardAmount: event.rewardAmount,
        maxWinners: event.maxWinners,
        winnersCount: event.winnersCount,
        remainingSlots: Math.max(event.maxWinners - event.winnersCount, 0),
        participation: participation
          ? {
              currentReferrals: participation.currentReferrals,
              currentLevelRank: participation.currentLevelRank,
              currentTeamMembers: participation.currentTeamMembers,
              qualified: participation.qualified,
              rewardClaimed: participation.rewardClaimed,
            }
          : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/rewards/weekly-events/:id/claim — atomic winner-limited reward. */
rewardsRouter.post(
  '/weekly-events/:id/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await weeklyEventService.claimReward(req.user!.id, req.params.id);
      res.json({ message: 'Weekly event reward claimed.', participation: result.participation });
    } catch (err) {
      next(err);
    }
  }
);

// --- Reward ledger & status -------------------------------------------------

/** GET /api/rewards/history — the unified reward ledger for the user. */
rewardsRouter.get('/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rewards = await RewardLedger.find({ userId: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ rewards });
  } catch (err) {
    next(err);
  }
});

/** GET /api/rewards/status — reward availability + audit notice. */
rewardsRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await systemSettingService.getSettings();
    const auditActive = await systemSettingService.isAuditModeActive();
    res.json({
      auditModeActive: auditActive,
      auditNotice: auditActive ? settings.auditNotice : null,
      luckyDrawAvailable: !(auditActive && settings.auditDisableTaskRewards),
    });
  } catch (err) {
    next(err);
  }
});

export default rewardsRouter;
