// src/routes/salary.ts
// Mine → Job Requirement / Job Application / My Position / Salary.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { salaryService } from '../services/salaryService';
import { JobApplication, ApplicationStatus } from '../models/JobApplication';
import { UserPosition, PositionStatus } from '../models/UserPosition';
import { PositionRetentionPeriod } from '../models/PositionRetentionPeriod';

export const salaryRouter = Router();

salaryRouter.use(requireAuth);
salaryRouter.use(apiLimiter);

/**
 * GET /api/salary/positions
 * Job Requirement page: every position with requirements, the user's real
 * progress, remaining requirements and eligibility/application status.
 */
salaryRouter.get('/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await salaryService.listPositionsWithProgress(req.user!.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salary/apply
 * Apply for an eligible position (eligibility is recalculated server-side).
 */
salaryRouter.post('/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { positionId } = req.body ?? {};
    if (!positionId || typeof positionId !== 'string') {
      res.status(422).json({ message: 'positionId is required.' });
      return;
    }
    const application = await salaryService.applyForPosition(req.user!.id, positionId);
    res.status(201).json({ application });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/salary/applications
 * The user's application history.
 */
salaryRouter.get('/applications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const applications = await JobApplication.find({ userId: req.user!.id }).sort({
      createdAt: -1,
    });
    res.json({ applications });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salary/applications/:id/withdraw
 * Withdraw a pending application.
 */
salaryRouter.post(
  '/applications/:id/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const application = await JobApplication.findOne({
        _id: req.params.id,
        userId: req.user!.id,
      });
      if (!application) {
        res.status(404).json({ message: 'Application not found.' });
        return;
      }
      if (application.status !== ApplicationStatus.UNDER_REVIEW) {
        res.status(409).json({ message: 'Only applications under review can be withdrawn.' });
        return;
      }
      application.status = ApplicationStatus.WITHDRAWN;
      await application.save();
      res.json({ application });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/salary/position
 * Mine → My Position: current/historical position, retention status and
 * every salary record (accumulating, ready to claim, claimed).
 */
salaryRouter.get('/position', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [current, history, ledger] = await Promise.all([
      UserPosition.findOne({
        userId: req.user!.id,
        status: {
          $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK],
        },
      }),
      UserPosition.find({
        userId: req.user!.id,
        status: { $in: [PositionStatus.DISQUALIFIED] },
      }).sort({ disqualifiedAt: -1 }),
      salaryService.getUserSalaryLedger(req.user!.id),
    ]);

    const retention = current
      ? await PositionRetentionPeriod.find({ userPositionId: current._id })
          .sort({ weekStart: -1 })
          .limit(12)
      : [];

    const claimable = ledger.filter((l) => l.status === 'READY_TO_CLAIM');

    res.json({
      currentPosition: current,
      positionHistory: history,
      retention,
      salaryLedger: ledger,
      claimableSalaries: claimable,
      canClaim: claimable.length > 0,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/salary/ledger
 * The dedicated salary ledger only.
 */
salaryRouter.get('/ledger', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ salaryLedger: await salaryService.getUserSalaryLedger(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/salary/:id/claim
 * Claim a READY TO CLAIM salary. Idempotent: a second request fails safely.
 */
salaryRouter.post('/:id/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ledger = await salaryService.claimSalary(req.user!.id, req.params.id);
    res.json({ message: 'Salary claimed successfully.', salary: ledger });
  } catch (err) {
    next(err);
  }
});

export default salaryRouter;
