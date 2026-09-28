// src/routes/adminPlatform.ts
// Admin: level management, task schedules, system settings, audit mode and the
// centralized financial ledger view. Mounted under /api/admin.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { User, UserRole } from '../models/User';
import { adminService } from '../services/adminService';
import { levelService } from '../services/levelService';
import { systemSettingService } from '../services/systemSettingService';
import { LevelConfig, LevelStatus } from '../models/LevelConfig';
import { TaskScheduleOverride, ScheduleOverrideType } from '../models/TaskScheduleOverride';
import { Transaction } from '../models/Transaction';

export const adminPlatformRouter = Router();

adminPlatformRouter.use(requireAuth);
adminPlatformRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

async function actorEmail(req: Request): Promise<string> {
  try {
    const user = await User.findById(req.user!.id).select('email');
    return user?.email ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Record an administrative action in the immutable audit trail. */
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

// --- Level management -------------------------------------------------------

/** GET /api/admin/levels — every level with configuration and user counts. */
adminPlatformRouter.get('/levels', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const levels = await levelService.listLevels();
    const counts = await User.aggregate<{ _id: number; count: number }>([
      { $group: { _id: '$vipLevel', count: { $sum: 1 } } },
    ]);
    const countByTier = new Map(counts.map((c) => [c._id ?? 0, c.count]));

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
        temporaryOpenStart: level.temporaryOpenStart,
        temporaryOpenEnd: level.temporaryOpenEnd,
        minDirectReferrals: level.minDirectReferrals,
        minTotalTeam: level.minTotalTeam,
        accessible: levelService.isLevelAccessible(level),
        userCount: countByTier.get(level.rank) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/levels/:code
 * Edit task quantity, reward per task, daily earning, open/lock, temporary
 * opening schedule and eligibility gates for a level.
 */
adminPlatformRouter.patch(
  '/levels/:code',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const before = await LevelConfig.findOne({ code: req.params.code.toUpperCase() });
      if (!before) {
        res.status(404).json({ message: `Level ${req.params.code} not found.` });
        return;
      }

      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) patch.name = String(body.name);
      if (body.status !== undefined) {
        if (!Object.values(LevelStatus).includes(body.status)) {
          res.status(422).json({ message: 'Status must be OPEN or LOCKED.' });
          return;
        }
        patch.status = body.status;
      }
      if (body.tasksPerDay !== undefined) {
        patch.tasksPerDay = Math.max(Math.round(Number(body.tasksPerDay)), 0);
      }
      if (body.rewardPerTask !== undefined) {
        patch.rewardPerTask = Math.max(Math.round(Number(body.rewardPerTask)), 0);
      }
      if (body.dailyEarning !== undefined) {
        patch.dailyEarning = Math.max(Math.round(Number(body.dailyEarning)), 0);
      }
      if (body.investment !== undefined) {
        patch.investment = Math.max(Math.round(Number(body.investment)), 0);
      }
      if (body.description !== undefined) patch.description = String(body.description);
      if (body.temporaryOpen !== undefined) patch.temporaryOpen = Boolean(body.temporaryOpen);
      if (body.temporaryOpenStart !== undefined) {
        patch.temporaryOpenStart = body.temporaryOpenStart ? new Date(body.temporaryOpenStart) : null;
      }
      if (body.temporaryOpenEnd !== undefined) {
        patch.temporaryOpenEnd = body.temporaryOpenEnd ? new Date(body.temporaryOpenEnd) : null;
      }
      if (body.minDirectReferrals !== undefined) {
        patch.minDirectReferrals = Math.max(Math.round(Number(body.minDirectReferrals)), 0);
      }
      if (body.minTotalTeam !== undefined) {
        patch.minTotalTeam = Math.max(Math.round(Number(body.minTotalTeam)), 0);
      }

      const level = await levelService.updateLevel(req.params.code, patch as never);
      await audit(req, 'level.update', 'level', level.code, {
        previous: {
          status: before.status,
          tasksPerDay: before.tasksPerDay,
          rewardPerTask: before.rewardPerTask,
          dailyEarning: before.dailyEarning,
        },
        next: patch,
      });
      res.json({ level });
    } catch (err) {
      next(err);
    }
  }
);

/** GET /api/admin/levels/:code/users — users currently at a level. */
adminPlatformRouter.get(
  '/levels/:code/users',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const level = await levelService.getByCode(req.params.code);
      if (!level) {
        res.status(404).json({ message: `Level ${req.params.code} not found.` });
        return;
      }
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      const users = await User.find({ vipLevel: level.rank })
        .select('fullName email status vipLevel createdAt')
        .sort({ createdAt: -1 })
        .limit(limit);
      res.json({ level: level.code, users });
    } catch (err) {
      next(err);
    }
  }
);

// --- Task schedule overrides ------------------------------------------------

/** GET /api/admin/schedule-overrides — holidays, audit days, forced dates. */
adminPlatformRouter.get(
  '/schedule-overrides',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const overrides = await TaskScheduleOverride.find({}).sort({ date: -1 }).limit(365);
      res.json({ overrides });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/schedule-overrides
 * Add or replace a date override (holiday, audit day, forced enable/disable).
 */
adminPlatformRouter.post(
  '/schedule-overrides',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const { date, overrideType, reason, enabled, applicableLevels } = body;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
        res.status(422).json({ message: 'date must be YYYY-MM-DD.' });
        return;
      }
      if (!Object.values(ScheduleOverrideType).includes(overrideType)) {
        res.status(422).json({
          message: `overrideType must be one of ${Object.values(ScheduleOverrideType).join(', ')}.`,
        });
        return;
      }

      const override = await TaskScheduleOverride.findOneAndUpdate(
        { date: String(date), overrideType },
        {
          $set: {
            date: String(date),
            overrideType,
            reason: reason ? String(reason) : overrideType,
            enabled: Boolean(enabled),
            applicableLevels: Array.isArray(applicableLevels) ? applicableLevels.map(String) : [],
          },
        },
        { new: true, upsert: true }
      );

      await audit(req, 'schedule.override.set', 'scheduleOverride', override._id.toString(), {
        date: override.date,
        overrideType: override.overrideType,
        enabled: override.enabled,
      });
      res.status(201).json({ override });
    } catch (err) {
      next(err);
    }
  }
);

/** DELETE /api/admin/schedule-overrides/:id — remove a date override. */
adminPlatformRouter.delete(
  '/schedule-overrides/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const removed = await TaskScheduleOverride.findByIdAndDelete(req.params.id);
      if (!removed) {
        res.status(404).json({ message: 'Schedule override not found.' });
        return;
      }
      await audit(req, 'schedule.override.delete', 'scheduleOverride', req.params.id, {
        date: removed.date,
      });
      res.json({ message: 'Schedule override removed.' });
    } catch (err) {
      next(err);
    }
  }
);

// --- System settings, audit mode & withdrawal rules -------------------------

/** GET /api/admin/settings — the full system configuration. */
adminPlatformRouter.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await systemSettingService.getSettings();
    const auditActive = await systemSettingService.isAuditModeActive();
    res.json({ settings, auditModeActive: auditActive });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/settings
 * Update withdrawal rules, task schedules, audit-mode notice and the Lucky
 * Draw referral condition. Changing financial settings never rewrites
 * historical transactions — values are snapshotted at transaction time.
 */
adminPlatformRouter.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    const numeric: Array<[string, number, number]> = [
      ['withdrawalFeePercent', 0, 100],
      ['minWithdrawal', 0, 100_000_000],
      ['maxWithdrawal', 0, 1_000_000_000],
      ['luckyDrawMinReferralDeposit', 0, 100_000_000],
    ];
    for (const [field, min, max] of numeric) {
      if (body[field] !== undefined) {
        const value = Number(body[field]);
        if (!Number.isFinite(value)) {
          res.status(422).json({ message: `${field} must be a number.` });
          return;
        }
        patch[field] = Math.min(Math.max(Math.round(value), min), max);
      }
    }

    const booleans = [
      'withdrawalFeeEnabled',
      'withdrawalSuspended',
      'taskWeekdaysEnabled',
      'taskSaturdayEnabled',
      'taskSundayEnabled',
      'taskInternWeekendEnabled',
      'auditDisableWithdrawals',
      'auditDisableTasks',
      'auditDisableTaskRewards',
    ];
    for (const field of booleans) {
      if (body[field] !== undefined) patch[field] = Boolean(body[field]);
    }

    if (body.withdrawalDays !== undefined) {
      if (!Array.isArray(body.withdrawalDays)) {
        res.status(422).json({ message: 'withdrawalDays must be an array of weekday numbers.' });
        return;
      }
      patch.withdrawalDays = body.withdrawalDays
        .map((d: unknown) => Math.round(Number(d)))
        .filter((d: number) => d >= 0 && d <= 6);
    }
    if (body.withdrawalStartTime !== undefined) patch.withdrawalStartTime = String(body.withdrawalStartTime);
    if (body.withdrawalEndTime !== undefined) patch.withdrawalEndTime = String(body.withdrawalEndTime);
    if (body.auditNotice !== undefined) patch.auditNotice = String(body.auditNotice);

    const settings = await systemSettingService.updateSettings(patch as never);

    await audit(req, 'settings.update', 'systemSetting', 'GLOBAL', {
      changed: Object.keys(patch),
      next: patch,
    });
    res.json({ settings });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/audit-mode
 * Turn Audit Mode on/off with optional start/end window and restrictions.
 * Existing records are never modified — only new operations are gated.
 */
adminPlatformRouter.post('/audit-mode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const patch: Record<string, unknown> = {};

    if (body.active !== undefined) patch.auditModeActive = Boolean(body.active);
    if (body.start !== undefined) patch.auditModeStart = body.start ? new Date(body.start) : null;
    if (body.end !== undefined) patch.auditModeEnd = body.end ? new Date(body.end) : null;
    if (body.notice !== undefined) patch.auditNotice = String(body.notice);
    if (body.disableWithdrawals !== undefined) {
      patch.auditDisableWithdrawals = Boolean(body.disableWithdrawals);
    }
    if (body.disableTasks !== undefined) patch.auditDisableTasks = Boolean(body.disableTasks);
    if (body.disableTaskRewards !== undefined) {
      patch.auditDisableTaskRewards = Boolean(body.disableTaskRewards);
    }

    const settings = await systemSettingService.updateSettings(patch as never);
    await audit(req, 'audit.mode.change', 'systemSetting', 'GLOBAL', patch);
    res.json({ settings, auditModeActive: await systemSettingService.isAuditModeActive() });
  } catch (err) {
    next(err);
  }
});

// --- Centralized financial ledger -------------------------------------------

/**
 * GET /api/admin/ledger?type=&userId=&limit=&skip=
 * Read-only, filterable view of every financial movement.
 */
adminPlatformRouter.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};
    if (req.query.type) query.type = String(req.query.type);
    if (req.query.userId) query.userId = String(req.query.userId);

    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const skip = Math.max(Number(req.query.skip ?? 0) || 0, 0);

    const [transactions, total] = await Promise.all([
      Transaction.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(query),
    ]);

    res.json({ transactions, total });
  } catch (err) {
    next(err);
  }
});

export default adminPlatformRouter;
