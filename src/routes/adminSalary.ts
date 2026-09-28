// src/routes/adminSalary.ts
// Admin: salary position management, job applications, retention monitoring,
// salary ledger and the scheduled salary/retention jobs.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { User, UserRole } from '../models/User';
import { adminService } from '../services/adminService';
import { salaryService } from '../services/salaryService';
import { SalaryPosition } from '../models/SalaryPosition';
import { JobApplication, ApplicationStatus } from '../models/JobApplication';
import { UserPosition, PositionStatus } from '../models/UserPosition';
import { PositionRetentionPeriod } from '../models/PositionRetentionPeriod';
import { SalaryLedger, SalaryStatus } from '../models/SalaryLedger';
import { Types } from 'mongoose';

export const adminSalaryRouter = Router();

adminSalaryRouter.use(requireAuth);
adminSalaryRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

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

// --- Position configuration -------------------------------------------------

/** GET /api/admin/salary/positions — all salary positions (active + disabled). */
adminSalaryRouter.get('/salary/positions', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const positions = await SalaryPosition.find({}).sort({ rank: 1 });
    const holders = await UserPosition.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] },
        },
      },
      { $group: { _id: '$positionCode', count: { $sum: 1 } } },
    ]);
    const byCode = new Map(holders.map((h) => [h._id, h.count]));
    res.json({
      positions: positions.map((p) => ({
        ...p.toObject(),
        activeHolders: byCode.get(p.code) ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/salary/positions/:code
 * Configure qualification, retention, salary and grace period. Historical
 * salary records keep the values used when they were created.
 */
adminSalaryRouter.patch(
  '/salary/positions/:code',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const position = await SalaryPosition.findOne({ code: req.params.code.toUpperCase() });
      if (!position) {
        res.status(404).json({ message: 'Salary position not found.' });
        return;
      }
      const body = req.body ?? {};
      const fields = [
        'title',
        'monthlySalary',
        'totalMembersReq',
        'directReferralsReq',
        'aboveLevel1Req',
        'retentionDirectReq',
        'retentionTeamReq',
        'gracePeriodDays',
      ] as const;

      const previous: Record<string, unknown> = {};
      for (const field of fields) {
        if (body[field] === undefined) continue;
        previous[field] = (position as unknown as Record<string, unknown>)[field];
        if (field === 'title') {
          position.title = String(body.title);
        } else {
          (position as unknown as Record<string, number>)[field] = Math.max(
            Math.round(Number(body[field])),
            0
          );
        }
      }
      if (body.active !== undefined) {
        previous.active = position.active;
        position.active = Boolean(body.active);
      }

      await position.save();
      await audit(req, 'salary.position.update', 'salaryPosition', position.code, {
        previous,
        next: body,
      });
      res.json({ position });
    } catch (err) {
      next(err);
    }
  }
);

// --- Job applications -------------------------------------------------------

/**
 * GET /api/admin/salary/applications?status=&positionCode=&search=
 * Review queue with the qualification snapshot taken at application time.
 */
adminSalaryRouter.get(
  '/salary/applications',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query: Record<string, unknown> = {};
      if (req.query.status && Object.values(ApplicationStatus).includes(req.query.status as ApplicationStatus)) {
        query.status = req.query.status;
      }
      if (req.query.positionCode) query.positionCode = String(req.query.positionCode).toUpperCase();

      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
      const applications = await JobApplication.find(query)
        .populate('userId', 'fullName email vipLevel')
        .sort({ createdAt: -1 })
        .limit(limit);

      res.json({ applications });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/salary/applications/:id/review
 * Approve (activates the position and starts salary accumulation) or reject.
 */
adminSalaryRouter.post(
  '/salary/applications/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { decision, remarks } = req.body ?? {};
      if (decision !== 'APPROVE' && decision !== 'REJECT') {
        res.status(422).json({ message: 'Decision must be APPROVE or REJECT.' });
        return;
      }

      const application = await salaryService.reviewApplication(
        req.params.id,
        req.user!.id,
        decision,
        remarks
      );

      await audit(req, 'salary.application.review', 'jobApplication', req.params.id, {
        decision,
        positionCode: application.positionCode,
        remarks,
      });

      res.json({ application });
    } catch (err) {
      next(err);
    }
  }
);

// --- Retention monitoring ---------------------------------------------------

/**
 * GET /api/admin/salary/retention?status=
 * Active / in-progress / at-risk / disqualified users with their latest
 * weekly evaluation.
 */
adminSalaryRouter.get(
  '/salary/retention',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query: Record<string, unknown> = {};
      const valid = Object.values(PositionStatus);
      if (req.query.status && valid.includes(req.query.status as PositionStatus)) {
        query.status = req.query.status;
      } else {
        query.status = { $in: valid };
      }

      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
      const positions = await UserPosition.find(query)
        .populate('userId', 'fullName email vipLevel')
        .sort({ updatedAt: -1 })
        .limit(limit);

      const periods = await PositionRetentionPeriod.find({
        userPositionId: { $in: positions.map((p) => p._id) },
      }).sort({ weekStart: -1 });

      const latestByPosition = new Map<string, (typeof periods)[number]>();
      for (const period of periods) {
        const key = period.userPositionId.toString();
        if (!latestByPosition.has(key)) latestByPosition.set(key, period);
      }

      res.json({
        positions: positions.map((p) => ({
          ...p.toObject(),
          latestRetention: latestByPosition.get(p._id.toString()) ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/salary/retention/:id/restore
 * Manually restore a disqualified/at-risk position (audited).
 */
adminSalaryRouter.post(
  '/salary/retention/:id/restore',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const position = await UserPosition.findById(req.params.id);
      if (!position) {
        res.status(404).json({ message: 'User position not found.' });
        return;
      }
      const previousStatus = position.status;
      position.status = PositionStatus.ACTIVE;
      position.restoredAt = new Date();
      position.restoredBy = new Types.ObjectId(req.user!.id);
      position.disqualifiedAt = undefined;
      position.disqualificationReason = undefined;
      position.failedRequirement = undefined;
      await position.save();

      await audit(req, 'salary.position.restore', 'userPosition', position._id.toString(), {
        previousStatus,
        reason: req.body?.reason,
      });
      res.json({ position });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/salary/retention/:id/disqualify
 * Manually disqualify a position (audited). Historical salary is untouched.
 */
adminSalaryRouter.post(
  '/salary/retention/:id/disqualify',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const position = await UserPosition.findById(req.params.id);
      if (!position) {
        res.status(404).json({ message: 'User position not found.' });
        return;
      }
      const previousStatus = position.status;
      position.status = PositionStatus.DISQUALIFIED;
      position.disqualifiedAt = new Date();
      position.disqualificationReason = req.body?.reason ? String(req.body.reason) : 'Manual disqualification';
      position.failedRequirement = req.body?.failedRequirement
        ? String(req.body.failedRequirement)
        : 'Manual review';
      await position.save();

      await audit(req, 'salary.position.disqualify', 'userPosition', position._id.toString(), {
        previousStatus,
        reason: position.disqualificationReason,
      });
      res.json({ position });
    } catch (err) {
      next(err);
    }
  }
);

// --- Salary ledger & scheduled jobs ----------------------------------------

/**
 * GET /api/admin/salary/ledger?status=&month=
 * Accumulating / ready-to-claim / claimed salary records.
 */
adminSalaryRouter.get('/salary/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};
    if (req.query.status && Object.values(SalaryStatus).includes(req.query.status as SalaryStatus)) {
      query.status = req.query.status;
    }
    if (req.query.month) query.salaryMonth = String(req.query.month);

    const limit = Math.min(Number(req.query.limit ?? 100) || 100, 300);
    const records = await SalaryLedger.find(query)
      .populate('userId', 'fullName email')
      .sort({ salaryMonth: -1, createdAt: -1 })
      .limit(limit);
    res.json({ salaryLedger: records });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/salary/jobs/finalize-month
 * Run the month-end salary finalization now. Idempotent: running it twice for
 * the same month finalizes each record only once and never double-credits.
 */
adminSalaryRouter.post(
  '/salary/jobs/finalize-month',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const month = req.body?.month ? String(req.body.month) : undefined;
      if (month && !/^\d{4}-\d{2}$/.test(month)) {
        res.status(422).json({ message: 'month must be YYYY-MM.' });
        return;
      }
      const result = await salaryService.finalizeMonthEnd(month);
      await audit(req, 'salary.job.finalizeMonth', 'salaryLedger', month ?? 'current', result);
      res.json({ message: 'Month-end salary finalization complete.', ...result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/salary/jobs/evaluate-retention
 * Run the weekly retention evaluation now (idempotent per week).
 */
adminSalaryRouter.post(
  '/salary/jobs/evaluate-retention',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await salaryService.evaluateWeeklyRetention();
      await audit(req, 'salary.job.evaluateRetention', 'userPosition', undefined, result);
      res.json({ message: 'Weekly retention evaluation complete.', ...result });
    } catch (err) {
      next(err);
    }
  }
);

export default adminSalaryRouter;
