// src/routes/adminFunds.ts
// Admin: full CRUD + status control for the Fund/Investment catalogue and the
// per-fund investor view. Mounted under /api/admin; every mutation is audited.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { User, UserRole } from '../models/User';
import { adminService } from '../services/adminService';
import { Fund, FundStatus, IFund } from '../models/Fund';
import { FundInvestment, FundInvestmentStatus } from '../models/FundInvestment';
import { fundService } from '../services/fundService';
import { validate } from '../validation/auth';
import { createFundSchema, updateFundSchema } from '../validation/funds';

export const adminFundsRouter = Router();

adminFundsRouter.use(requireAuth);
adminFundsRouter.use(requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN));

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

function toAdminFundDTO(fund: IFund, investorCount = 0, totalInvested = 0) {
  return {
    ...fundService.toFundDTO(fund),
    investorCount,
    totalInvested,
  };
}

/**
 * GET /api/admin/funds
 * Every fund with investor counts and invested totals.
 */
adminFundsRouter.get('/funds', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const funds = await Fund.find({}).sort({ createdAt: -1 });
    const aggregates = await FundInvestment.aggregate<{ _id: unknown; count: number; total: number }>([
      { $group: { _id: '$fundId', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]);
    const byFund = new Map(aggregates.map((a) => [String(a._id), a]));

    res.json({
      funds: funds.map((fund) => {
        const agg = byFund.get(fund._id.toString());
        return toAdminFundDTO(fund, agg?.count ?? 0, agg?.total ?? 0);
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/funds — create a fund (status defaults to ACTIVE).
 */
adminFundsRouter.post(
  '/funds',
  validate(createFundSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      const fund = await Fund.create({
        name: body.name,
        category: body.category,
        amount: body.amount,
        durationDays: body.durationDays,
        expectedReturn: body.expectedReturn,
        description: body.description,
        startDate: body.startDate,
        endDate: body.endDate,
        status: body.status ?? FundStatus.ACTIVE,
      });
      await audit(req, 'fund.create', 'fund', fund._id.toString(), {
        name: fund.name,
        category: fund.category,
        amount: fund.amount,
      });
      res.status(201).json({ fund: toAdminFundDTO(fund) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/admin/funds/:id — edit fields, including status switches
 * (activate / deactivate / mark sold out / mark completed).
 */
adminFundsRouter.patch(
  '/funds/:id',
  validate(updateFundSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fund = await Fund.findById(req.params.id);
      if (!fund) {
        res.status(404).json({ message: 'Fund not found.' });
        return;
      }

      const body = req.body ?? {};
      const patch: Record<string, unknown> = {};
      for (const key of [
        'name',
        'category',
        'amount',
        'durationDays',
        'expectedReturn',
        'description',
        'startDate',
        'endDate',
        'status',
      ] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      const before = { status: fund.status, amount: fund.amount, endDate: fund.endDate };

      Object.assign(fund, patch);
      await fund.save();

      await audit(req, 'fund.update', 'fund', fund._id.toString(), {
        previous: before,
        next: patch,
      });
      res.json({ fund: toAdminFundDTO(fund) });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/admin/funds/:id
 * Funds with investments are kept forever so user records stay traceable.
 */
adminFundsRouter.delete('/funds/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const fund = await Fund.findById(req.params.id);
    if (!fund) {
      res.status(404).json({ message: 'Fund not found.' });
      return;
    }

    const investors = await FundInvestment.countDocuments({ fundId: fund._id });
    if (investors > 0) {
      res.status(409).json({
        message: `This fund has ${investors} investment record(s) and cannot be deleted — deactivate it instead.`,
      });
      return;
    }

    await fund.deleteOne();
    await audit(req, 'fund.delete', 'fund', req.params.id, { name: fund.name });
    res.json({ message: 'Fund deleted.' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/funds/:id/investors
 * Who invested, how much, when, maturity date and investment status.
 */
adminFundsRouter.get(
  '/funds/:id/investors',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fund = await Fund.findById(req.params.id);
      if (!fund) {
        res.status(404).json({ message: 'Fund not found.' });
        return;
      }

      const investments = await FundInvestment.find({ fundId: fund._id })
        .populate('userId', 'fullName email vipLevel')
        .sort({ createdAt: -1 });

      const [stats] = await FundInvestment.aggregate<{ _id: null; count: number; total: number }>([
        { $match: { fundId: fund._id } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } },
      ]);

      res.json({
        fund: toAdminFundDTO(fund, stats?.count ?? 0, stats?.total ?? 0),
        investors: investments.map((inv) => {
          const user = inv.userId as unknown as
            | { _id: unknown; fullName?: string; email?: string; vipLevel?: number }
            | null;
          const matured =
            inv.status === FundInvestmentStatus.ACTIVE && inv.maturesAt.getTime() <= Date.now();
          return {
            id: inv._id.toString(),
            userId: user?._id?.toString() ?? inv.userId.toString(),
            fullName: user?.fullName ?? 'Unknown user',
            email: user?.email ?? '',
            vipLevel: user?.vipLevel ?? 0,
            amount: inv.amount,
            expectedReturn: inv.expectedReturn,
            investedAt: inv.createdAt.toISOString(),
            startDate: inv.startDate.toISOString(),
            maturesAt: inv.maturesAt.toISOString(),
            status: matured ? FundInvestmentStatus.MATURED : inv.status,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  }
);

export default adminFundsRouter;
