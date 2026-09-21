// src/routes/admin.ts
// Administrative endpoints (ADMIN / SUPER_ADMIN).
//
// The full admin console ships in Phase 7; these routes are the approval
// mechanisms the console (and ops staff) rely on today.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { UserRole } from '../models/User';
import { apiLimiter } from '../middleware/rateLimiter';
import { paymentService } from '../services/paymentService';
import { Deposit, DepositStatus } from '../models/Deposit';
import { Withdrawal, WithdrawalStatus } from '../models/Withdrawal';

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));
adminRouter.use(apiLimiter);

function isFlagged(v: unknown): v is 'APPROVE' | 'REJECT' {
  return v === 'APPROVE' || v === 'REJECT';
}

/**
 * GET /api/admin/deposits?status=
 * Review queue for deposit requests.
 */
adminRouter.get('/deposits', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};
    if (req.query.status && Object.values(DepositStatus).includes(req.query.status as DepositStatus)) {
      query.status = req.query.status;
    }
    const deposits = await Deposit.find(query).sort({ createdAt: -1 }).limit(100);
    res.json({ deposits });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/deposits/:id/review
 * Approve (credits the wallet) or reject a pending deposit.
 */
adminRouter.post(
  '/deposits/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isFlagged(req.body.decision)) {
        return res.status(422).json({ message: 'Decision must be APPROVE or REJECT.' });
      }
      const deposit = await paymentService.reviewDeposit(
        req.params.id,
        req.user!.id,
        req.body.decision,
        req.body.note
      );
      res.json({ deposit });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/withdrawals?status=
 * Review queue for withdrawal requests.
 */
adminRouter.get('/withdrawals', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};
    if (
      req.query.status &&
      Object.values(WithdrawalStatus).includes(req.query.status as WithdrawalStatus)
    ) {
      query.status = req.query.status;
    }
    const withdrawals = await Withdrawal.find(query).sort({ createdAt: -1 }).limit(100);
    res.json({ withdrawals });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/withdrawals/:id/review
 * Approve (debits the wallet) or reject a pending withdrawal.
 */
adminRouter.post(
  '/withdrawals/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isFlagged(req.body.decision)) {
        return res.status(422).json({ message: 'Decision must be APPROVE or REJECT.' });
      }
      const withdrawal = await paymentService.reviewWithdrawal(
        req.params.id,
        req.user!.id,
        req.body.decision,
        req.body.note
      );
      res.json({ withdrawal });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/withdrawals/:id/paid
 * Mark an approved withdrawal as PAID once the transfer settles.
 */
adminRouter.post('/withdrawals/:id/paid', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const withdrawal = await paymentService.markPaid(req.params.id, req.user!.id);
    res.json({ withdrawal });
  } catch (err) {
    next(err);
  }
});

export default adminRouter;
