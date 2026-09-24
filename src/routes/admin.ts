// src/routes/admin.ts
// Administrative endpoints (ADMIN / SUPER_ADMIN).

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { AccountStatus, User, UserRole } from '../models/User';
import { adminService } from '../services/adminService';
import { vipService } from '../services/vipService';
import { Deposit, DepositStatus } from '../models/Deposit';
import { Withdrawal, WithdrawalStatus } from '../models/Withdrawal';
import { VipPurchase, VipPurchaseStatus } from '../models/VipPurchase';
import { paymentService } from '../services/paymentService';
import { paystackService } from '../services/paystackService';

export const adminRouter = Router();

adminRouter.use(requireAuth);
// The global `/api` limiter already protects admin requests. Do not install the
// same limiter again here: admin dashboards use SWR revalidation and a second
// count caused legitimate queues to receive 429 responses.
adminRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

function isFlagged(v: unknown): v is 'APPROVE' | 'REJECT' {
  return v === 'APPROVE' || v === 'REJECT';
}

/** Resolve the acting admin's email for the audit trail. */
async function actorEmail(req: Request): Promise<string> {
  try {
    const user = await User.findById(req.user!.id).select('email');
    return user?.email ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Record an admin action in the audit log (fire-and-forget). */
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

/**
 * GET /api/admin/deposits?status=
 * Read-only reconciliation queue for deposits. Deposits are credited
 * exclusively by the Paystack webhook — admin cannot approve or reject them.
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
    const withdrawals = await Withdrawal.find(query)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(100);
    // Admin actions use the stable DTO identifier. Raw Mongoose documents only
    // expose `_id`, which made the client construct `/withdrawals/undefined`.
    res.json({
      withdrawals: withdrawals.map((withdrawal) => ({
        ...withdrawal.toObject(),
        id: withdrawal._id.toString(),
      })),
    });
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
      await audit(req, `withdrawal.${req.body.decision.toLowerCase()}`, 'withdrawal', req.params.id, {
        amount: withdrawal.amount,
      });
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
    await audit(req, 'withdrawal.paid', 'withdrawal', req.params.id, { amount: withdrawal.amount });
    res.json({ withdrawal });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/paystack/balance — current platform Paystack balance (kobo). */
adminRouter.get('/paystack/balance', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const balance = await paystackService.getBalance();
    res.json({ balance });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/paystack/transactions?limit= — recent Paystack activity. */
adminRouter.get(
  '/paystack/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = Number.parseInt(String(req.query.limit ?? '20'), 10);
      const limit = Number.isNaN(parsed) ? 20 : Math.min(Math.max(parsed, 1), 100);
      const transactions = await paystackService.listTransactions(limit);
      res.json({ transactions });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/stats
 * Platform-wide counters for the admin dashboard.
 */
adminRouter.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await adminService.getStats();
    res.json({ stats });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users?search=&status=&limit=&skip=
 * Paginated user list.
 */
adminRouter.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status =
      req.query.status && Object.values(AccountStatus).includes(req.query.status as AccountStatus)
        ? (req.query.status as AccountStatus)
        : undefined;
    const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 25;
    const skip = req.query.skip ? Number.parseInt(String(req.query.skip), 10) : 0;
    const result = await adminService.listUsers({
      search: req.query.search ? String(req.query.search) : undefined,
      status,
      limit: Number.isNaN(limit) ? 25 : limit,
      skip: Number.isNaN(skip) ? 0 : skip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/status
 * Activate, suspend or deactivate an account.
 */
adminRouter.post('/users/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!Object.values(AccountStatus).includes(req.body.status)) {
      return res.status(422).json({
        message: `Status must be one of ${Object.values(AccountStatus).join(', ')}.`,
      });
    }
    const user = await adminService.setUserStatus(req.params.id, req.body.status);
    await audit(req, `user.status.${String(req.body.status).toLowerCase()}`, 'user', req.params.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/vip/purchases/:id/review
 * Approve or reject a pending VIP purchase (credits nothing; activates a level).
 */
adminRouter.post(
  '/vip/purchases/:id/review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isFlagged(req.body.decision)) {
        return res.status(422).json({ message: 'Decision must be APPROVE or REJECT.' });
      }
      const purchase = await vipService.reviewPurchase(
        req.params.id,
        req.user!.id,
        req.body.decision,
        req.body.note
      );
      await audit(req, `vip.${req.body.decision.toLowerCase()}`, 'vip_purchase', req.params.id, {
        levelCode: purchase.levelCode,
      });
      res.json({ purchase });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/vip/purchases?status=
 * VIP purchase review queue.
 */
adminRouter.get('/vip/purchases', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query: Record<string, unknown> = {};
    if (
      req.query.status &&
      Object.values(VipPurchaseStatus).includes(req.query.status as VipPurchaseStatus)
    ) {
      query.status = req.query.status;
    }
    const purchases = await VipPurchase.find(query)
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ purchases });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id
 * Full user profile: account, wallet + ledger (READ-ONLY), deposits,
 * withdrawals, VIP purchases, referral/task metrics.
 */
adminRouter.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await adminService.getUserDetail(req.params.id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/password
 * Admin-initiated password reset. Wallet and ledger are never touched.
 */
adminRouter.post('/users/:id/password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await adminService.resetUserPassword(req.params.id, req.body.password);
    await audit(req, 'user.password.reset', 'user', req.params.id, { email: result.email });
    res.json({ message: `Password updated for ${result.email}.` });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/role
 * Change a user's role (SUPER_ADMIN only).
 */
adminRouter.post(
  '/users/:id/role',
  requireRole(UserRole.SUPER_ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.user!.id === req.params.id) {
        return res.status(422).json({ message: 'You cannot change your own role.' });
      }
      const user = await adminService.setUserRole(req.params.id, req.body.role);
      await audit(req, 'user.role.change', 'user', req.params.id, { role: user.role });
      res.json({ user });
    } catch (err) {
      next(err);
    }
  }
);

// --- Tasks -----------------------------------------------------------------

/**
 * GET /api/admin/tasks — every task definition (including inactive).
 */
adminRouter.get('/tasks', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const tasks = await adminService.listTasks();
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/tasks — create a task definition.
 */
adminRouter.post('/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await adminService.createTask(req.body);
    await audit(req, 'task.create', 'task', task.key, { reward: task.reward });
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/tasks/:key — update a task definition.
 */
adminRouter.patch('/tasks/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const task = await adminService.updateTask(req.params.key, req.body);
    await audit(req, 'task.update', 'task', task.key, {
      reward: task.reward,
      minVipTier: task.minVipTier,
      active: task.active,
    });
    res.json({ task });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/admin/tasks/:key — remove a task definition.
 */
adminRouter.delete('/tasks/:key', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await adminService.deleteTask(req.params.key);
    await audit(req, 'task.delete', 'task', result.key);
    res.json({ message: `Task "${result.key}" deleted.` });
  } catch (err) {
    next(err);
  }
});

// --- Audit log -------------------------------------------------------------

/**
 * GET /api/admin/audit-logs?action=&targetId=&limit=&skip=
 * Read-only trail of every administrative action.
 */
adminRouter.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 50;
    const skip = req.query.skip ? Number.parseInt(String(req.query.skip), 10) : 0;
    const result = await adminService.listAuditLogs({
      action: req.query.action ? String(req.query.action) : undefined,
      targetId: req.query.targetId ? String(req.query.targetId) : undefined,
      limit: Number.isNaN(limit) ? 50 : limit,
      skip: Number.isNaN(skip) ? 0 : skip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/paystack/balance — live Paystack ledger balance (kobo). */
adminRouter.get('/paystack/balance', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ balance: await paystackService.getBalance() });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/paystack/transactions — live Paystack transaction history. */
adminRouter.get('/paystack/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 20;
    res.json({ transactions: await paystackService.listTransactions(Number.isNaN(limit) ? 20 : limit) });
  } catch (err) {
    next(err);
  }
});

// --- Withdrawal export -----------------------------------------------------

/**
 * GET /api/admin/withdrawals/export?status=APPROVED
 * CSV of withdrawal requests for bank batch payouts.
 */
adminRouter.get('/withdrawals/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status =
      req.query.status && Object.values(WithdrawalStatus).includes(req.query.status as WithdrawalStatus)
        ? (req.query.status as WithdrawalStatus)
        : WithdrawalStatus.APPROVED;

    const withdrawals = await Withdrawal.find({ status })
      .populate<{ userId: { fullName: string; email: string } | null }>('userId', 'fullName email')
      .sort({ createdAt: 1 })
      .limit(1000);

    const header = 'reference,user,email,amount,bank,accountNumber,accountName,status,createdAt,payoutEta';
    const rows = withdrawals.map((w) => {
      const user = w.userId as unknown as { fullName?: string; email?: string } | null;
      return [
        w.reference,
        user?.fullName ?? 'Unknown user',
        user?.email ?? '',
        String(w.amount),
        w.bankName,
        w.accountNumber,
        w.accountName,
        w.status,
        w.createdAt.toISOString(),
        w.payoutEta ? w.payoutEta.toISOString() : '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(',');
    });

    await audit(req, 'withdrawal.export', 'withdrawal', undefined, {
      status,
      count: withdrawals.length,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="withdrawals-${status.toLowerCase()}.csv"`);
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    next(err);
  }
});

export default adminRouter;
