// src/routes/settings.ts
// Public, non-sensitive platform configuration for the authenticated user
// (withdrawal rules, task schedule, audit-mode notice).

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { systemSettingService } from '../services/systemSettingService';
import { taskScheduleService } from '../services/taskScheduleService';
import { levelService } from '../services/levelService';
import { User } from '../models/User';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);
settingsRouter.use(apiLimiter);

/** GET /api/settings — the user-facing platform configuration. */
settingsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const settings = await systemSettingService.getSettings();
    const auditActive = await systemSettingService.isAuditModeActive();
    res.json({
      settings: {
        auditModeActive: auditActive,
        auditNotice: auditActive ? settings.auditNotice : null,
        withdrawals: {
          enabled: !settings.withdrawalSuspended && !(auditActive && settings.auditDisableWithdrawals),
          feePercent: settings.withdrawalFeeEnabled ? settings.withdrawalFeePercent : 0,
          feeEnabled: settings.withdrawalFeeEnabled,
          min: settings.minWithdrawal,
          max: settings.maxWithdrawal,
          days: settings.withdrawalDays,
          startTime: settings.withdrawalStartTime,
          endTime: settings.withdrawalEndTime,
          suspended: settings.withdrawalSuspended,
        },
        tasks: {
          weekdaysEnabled: settings.taskWeekdaysEnabled,
          saturdayEnabled: settings.taskSaturdayEnabled,
          sundayEnabled: settings.taskSundayEnabled,
          internWeekendEnabled: settings.taskInternWeekendEnabled,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/task-availability
 * Whether the authenticated user can complete tasks right now, with the
 * human-readable reason when they cannot.
 */
settingsRouter.get(
  '/task-availability',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await User.findById(req.user!.id).select('vipLevel');
      const level = await levelService.getByRank(user?.vipLevel ?? 0);
      const code = level ? level.code : 'INTERN';
      const availability = await taskScheduleService.evaluateTaskAvailability(
        code,
        new Date(),
        req.user!.id
      );
      res.json({ levelCode: code, ...availability });
    } catch (err) {
      next(err);
    }
  }
);

export default settingsRouter;
