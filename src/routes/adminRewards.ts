// src/routes/adminRewards.ts
// Admin: Lucky Draw prizes/spins, Red Envelope campaigns/claims and Weekly
// Events. Mounted under /api/admin.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { User, UserRole } from '../models/User';
import { adminService } from '../services/adminService';
import { LuckyDrawPrize } from '../models/LuckyDrawPrize';
import { LuckyDrawSpin } from '../models/LuckyDrawSpin';
import { LuckyDrawEntitlement } from '../models/LuckyDrawEntitlement';
import { RedEnvelopeCampaign } from '../models/RedEnvelopeCampaign';
import { RedEnvelopeClaim } from '../models/RedEnvelopeClaim';
import { WeeklyEvent, EventRewardType } from '../models/WeeklyEvent';
import { WeeklyEventParticipation } from '../models/WeeklyEventParticipation';
import { RewardLedger } from '../models/RewardLedger';

export const adminRewardsRouter = Router();

adminRewardsRouter.use(requireAuth);
adminRewardsRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

async function actorEmail(req: Request): Promise<string> {
  try {
    const user = await User.findById(req.user!.id).select('email');
    return user?.email ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function audit(
  req: Request,
  action: string,
  targetType: string,
  targetId?: string,
  meta?: Record<string, unknown>
): Promise<void> {
  await adminService.record({
    actorId: req.user!.id,
    actorEmail: await actorEmail(req),
    action,
    targetType,
    targetId,
    meta,
    ip: req.ip,
  });
}

// --- Lucky Draw: prizes, probability & records ------------------------------

/** GET /api/admin/rewards/lucky-draw/prizes */
adminRewardsRouter.get(
  '/rewards/lucky-draw/prizes',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const prizes = await LuckyDrawPrize.find({}).sort({ sortOrder: 1 });
      const totalWeight = prizes.reduce((sum, p) => sum + (p.active ? p.weight : 0), 0);
      res.json({
        prizes: prizes.map((p) => ({
          ...p.toObject(),
          probabilityPercent:
            p.active && totalWeight > 0
              ? Number(((p.weight / totalWeight) * 100).toFixed(4))
              : 0,
        })),
        totalActiveWeight: totalWeight,
      });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/admin/rewards/lucky-draw/prizes — add a prize to the pool. */
adminRewardsRouter.post(
  '/rewards/lucky-draw/prizes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { label, amount, weight, sortOrder, color } = req.body ?? {};
      if (!label || !Number.isFinite(Number(amount)) || !Number.isFinite(Number(weight))) {
        res.status(422).json({ message: 'label, amount and weight are required.' });
        return;
      }
      const prize = await LuckyDrawPrize.create({
        label: String(label),
        amount: Math.max(Math.round(Number(amount)), 0),
        weight: Math.max(Math.round(Number(weight)), 1),
        sortOrder: Math.round(Number(sortOrder ?? 0)) || 0,
        color: color ? String(color) : undefined,
      });
      await audit(req, 'luckyDraw.prize.create', 'luckyDrawPrize', prize._id.toString(), {
        label: prize.label,
        amount: prize.amount,
        weight: prize.weight,
      });
      res.status(201).json({ prize });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/admin/rewards/lucky-draw/prizes/:id
 * Update amount/probability/order/active. Historical spin records keep the
 * amount and label that were awarded at spin time.
 */
adminRewardsRouter.patch(
  '/rewards/lucky-draw/prizes/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prize = await LuckyDrawPrize.findById(req.params.id);
      if (!prize) {
        res.status(404).json({ message: 'Prize not found.' });
        return;
      }
      const body = req.body ?? {};
      const previous = { amount: prize.amount, weight: prize.weight, active: prize.active };

      if (body.label !== undefined) prize.label = String(body.label);
      if (body.amount !== undefined) prize.amount = Math.max(Math.round(Number(body.amount)), 0);
      if (body.weight !== undefined) prize.weight = Math.max(Math.round(Number(body.weight)), 1);
      if (body.sortOrder !== undefined) prize.sortOrder = Math.round(Number(body.sortOrder));
      if (body.active !== undefined) prize.active = Boolean(body.active);
      if (body.color !== undefined) prize.color = String(body.color);
      await prize.save();

      await audit(req, 'luckyDraw.prize.update', 'luckyDrawPrize', prize._id.toString(), {
        previous,
        next: body,
      });
      res.json({ prize });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /api/admin/rewards/lucky-draw/prizes/:id — remove from the pool. */
adminRewardsRouter.delete(
  '/rewards/lucky-draw/prizes/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const prize = await LuckyDrawPrize.findByIdAndDelete(req.params.id);
      if (!prize) {
        res.status(404).json({ message: 'Prize not found.' });
        return;
      }
      await audit(req, 'luckyDraw.prize.delete', 'luckyDrawPrize', req.params.id, {
        label: prize.label,
      });
      res.json({ message: 'Prize removed.' });
    } catch (err) {
      next(err);
    }
  }
);

// --- Lucky Draw: spin, winner & entitlement records -------------------------

/** GET /api/admin/rewards/lucky-draw/spins — spin records and winners. */
adminRewardsRouter.get(
  '/rewards/lucky-draw/spins',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
      const spins = await LuckyDrawSpin.find({})
        .populate('userId', 'fullName email')
        .sort({ createdAt: -1 })
        .limit(limit);
      res.json({ spins });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/rewards/lucky-draw/entitlements — referral → spin records. */
adminRewardsRouter.get(
  '/rewards/lucky-draw/entitlements',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
      const entitlements = await LuckyDrawEntitlement.find({})
        .populate('referrerId', 'fullName email')
        .populate('referredUserId', 'fullName email')
        .sort({ awardedAt: -1 })
        .limit(limit);
      res.json({ entitlements });
    } catch (err) {
      next(err);
    }
  }
);

// --- Red Envelope -----------------------------------------------------------

/** GET /api/admin/rewards/red-envelope/campaigns */
adminRewardsRouter.get(
  '/rewards/red-envelope/campaigns',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const campaigns = await RedEnvelopeCampaign.find({}).sort({ createdAt: -1 });
      res.json({
        campaigns: campaigns.map((c) => ({
          ...c.toObject(),
          distributedAmount: c.totalBudget - c.remainingBudget,
          claimedCount: c.maxWinners - c.remainingClaims,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/rewards/red-envelope/campaigns
 * Create a campaign with a budget ceiling and winner cap.
 */
adminRewardsRouter.post(
  '/rewards/red-envelope/campaigns',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { title, claimCode, totalBudget, maxWinners, minAmount, maxAmount, isRandom, startDate, endDate } =
        req.body ?? {};

      if (!title || !claimCode) {
        res.status(422).json({ message: 'title and claimCode are required.' });
        return;
      }
      const budget = Math.round(Number(totalBudget));
      const winners = Math.round(Number(maxWinners));
      const min = Math.round(Number(minAmount));
      const max = Math.round(Number(maxAmount));

      if (!Number.isFinite(budget) || budget <= 0) {
        res.status(422).json({ message: 'totalBudget must be a positive whole number.' });
        return;
      }
      if (!Number.isFinite(winners) || winners <= 0) {
        res.status(422).json({ message: 'maxWinners must be a positive whole number.' });
        return;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
        res.status(422).json({ message: 'minAmount/maxAmount must be positive and max >= min.' });
        return;
      }
      if (budget < winners * min) {
        res.status(422).json({
          message: 'Budget must be at least maxWinners × minAmount so every winner can be paid.',
        });
        return;
      }

      const { redEnvelopeService } = await import('../services/redEnvelopeService');
      const campaign = await redEnvelopeService.createCampaign({
        title: String(title),
        claimCode: String(claimCode),
        totalBudget: budget,
        maxWinners: winners,
        minAmount: min,
        maxAmount: max,
        isRandom: isRandom === undefined ? true : Boolean(isRandom),
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: req.user!.id,
      });

      await audit(req, 'redEnvelope.campaign.create', 'redEnvelopeCampaign', campaign._id.toString(), {
        claimCode: campaign.claimCode,
        totalBudget: campaign.totalBudget,
        maxWinners: campaign.maxWinners,
      });
      res.status(201).json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/** PATCH /api/admin/rewards/red-envelope/campaigns/:id — activate/deactivate. */
adminRewardsRouter.patch(
  '/rewards/red-envelope/campaigns/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const campaign = await RedEnvelopeCampaign.findById(req.params.id);
      if (!campaign) {
        res.status(404).json({ message: 'Campaign not found.' });
        return;
      }
      const previous = { active: campaign.active, endDate: campaign.endDate };
      if (req.body?.active !== undefined) campaign.active = Boolean(req.body.active);
      if (req.body?.endDate !== undefined) campaign.endDate = new Date(req.body.endDate);
      await campaign.save();

      await audit(req, 'redEnvelope.campaign.update', 'redEnvelopeCampaign', campaign._id.toString(), {
        previous,
        next: req.body,
      });
      res.json({ campaign });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/rewards/red-envelope/claims — every claim (winners). */
adminRewardsRouter.get(
  '/rewards/red-envelope/claims',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
      const claims = await RedEnvelopeClaim.find({})
        .populate('userId', 'fullName email')
        .populate('campaignId', 'title claimCode')
        .sort({ claimedAt: -1 })
        .limit(limit);
      res.json({ claims });
    } catch (err) {
      next(err);
    }
  }
);

// --- Weekly Events ----------------------------------------------------------

/** GET /api/admin/rewards/weekly-events?status=active|upcoming|previous */
adminRewardsRouter.get(
  '/rewards/weekly-events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const query: Record<string, unknown> = {};
      const status = req.query.status ? String(req.query.status) : undefined;
      if (status === 'active') {
        query.active = true;
        query.startDate = { $lte: now };
        query.endDate = { $gte: now };
      } else if (status === 'upcoming') {
        query.startDate = { $gt: now };
      } else if (status === 'previous') {
        query.endDate = { $lt: now };
      }

      const events = await WeeklyEvent.find(query).sort({ startDate: -1 }).limit(200);
      res.json({
        events: events.map((e) => ({
          ...e.toObject(),
          remainingSlots: Math.max(e.maxWinners - e.winnersCount, 0),
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/** POST /api/admin/rewards/weekly-events — create an event. */
adminRewardsRouter.post(
  '/rewards/weekly-events',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        title,
        description,
        startDate,
        endDate,
        requiredReferrals,
        requiredLevelRank,
        requiredTeamMembers,
        rewardType,
        rewardAmount,
        maxWinners,
      } = req.body ?? {};

      if (!title || !description) {
        res.status(422).json({ message: 'title and description are required.' });
        return;
      }
      if (!Object.values(EventRewardType).includes(rewardType)) {
        res.status(422).json({
          message: `rewardType must be one of ${Object.values(EventRewardType).join(', ')}.`,
        });
        return;
      }
      const amount = Math.round(Number(rewardAmount));
      const winners = Math.round(Number(maxWinners));
      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(422).json({ message: 'rewardAmount must be a positive whole number.' });
        return;
      }
      if (!Number.isFinite(winners) || winners <= 0) {
        res.status(422).json({ message: 'maxWinners must be a positive whole number.' });
        return;
      }

      const event = await WeeklyEvent.create({
        title: String(title),
        description: String(description),
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        requiredReferrals: Math.max(Math.round(Number(requiredReferrals ?? 0)) || 0, 0),
        requiredLevelRank: Math.max(Math.round(Number(requiredLevelRank ?? 0)) || 0, 0),
        requiredTeamMembers: Math.max(Math.round(Number(requiredTeamMembers ?? 0)) || 0, 0),
        rewardType,
        rewardAmount: amount,
        maxWinners: winners,
        active: true,
        createdBy: req.user!.id,
      });

      await audit(req, 'weeklyEvent.create', 'weeklyEvent', event._id.toString(), {
        title: event.title,
        rewardType: event.rewardType,
        rewardAmount: event.rewardAmount,
        maxWinners: event.maxWinners,
      });
      res.status(201).json({ event });
    } catch (err) {
      next(err);
    }
  }
);

/** PATCH /api/admin/rewards/weekly-events/:id — activate/deactivate/extend. */
adminRewardsRouter.patch(
  '/rewards/weekly-events/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = await WeeklyEvent.findById(req.params.id);
      if (!event) {
        res.status(404).json({ message: 'Event not found.' });
        return;
      }
      const previous = { active: event.active, endDate: event.endDate };
      if (req.body?.active !== undefined) event.active = Boolean(req.body.active);
      if (req.body?.endDate !== undefined) event.endDate = new Date(req.body.endDate);
      if (req.body?.maxWinners !== undefined) {
        event.maxWinners = Math.max(Math.round(Number(req.body.maxWinners)), 1);
      }
      await event.save();

      await audit(req, 'weeklyEvent.update', 'weeklyEvent', event._id.toString(), {
        previous,
        next: req.body,
      });
      res.json({ event });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/rewards/weekly-events/:id/participants */
adminRewardsRouter.get(
  '/rewards/weekly-events/:id/participants',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 200) || 200, 500);
      const participants = await WeeklyEventParticipation.find({ eventId: req.params.id })
        .populate('userId', 'fullName email vipLevel')
        .sort({ updatedAt: -1 })
        .limit(limit);
      res.json({
        participants,
        qualified: participants.filter((p) => p.qualified).length,
        rewarded: participants.filter((p) => p.rewardClaimed).length,
      });
    } catch (err) {
      next(err);
    }
  }
);

// --- Unified reward ledger --------------------------------------------------

/** GET /api/admin/rewards/history?feature= — every reward record. */
adminRewardsRouter.get(
  '/rewards/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query: Record<string, unknown> = {};
      if (req.query.feature) query.feature = String(req.query.feature);
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
      const rewards = await RewardLedger.find(query).sort({ createdAt: -1 }).limit(limit);
      res.json({ rewards });
    } catch (err) {
      next(err);
    }
  }
);

export default adminRewardsRouter;
