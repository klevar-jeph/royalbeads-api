// src/controllers/walletController.ts
// Thin HTTP controllers for wallet/payment endpoints.

import { Request, Response, NextFunction } from 'express';
import { walletService } from '../services/walletService';
import { paymentService } from '../services/paymentService';
import { TransactionType } from '../models/Transaction';
import { DepositStatus, IDeposit } from '../models/Deposit';
import { WithdrawalStatus, IWithdrawal } from '../models/Withdrawal';
import { User } from '../models/User';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function toDepositDTO(d: IDeposit) {
  return {
    id: d._id.toString(),
    amount: d.amount,
    method: d.method,
    status: d.status,
    reference: d.reference,
    note: d.note,
    reviewNote: d.reviewNote,
    authorizationUrl: (d as unknown as { authorizationUrl?: string }).authorizationUrl,
    createdAt: d.createdAt.toISOString(),
    reviewedAt: d.reviewedAt?.toISOString(),
  };
}

function toWithdrawalDTO(w: IWithdrawal) {
  return {
    id: w._id.toString(),
    amount: w.amount,
    bankName: w.bankName,
    accountNumber: w.accountNumber,
    accountName: w.accountName,
    status: w.status,
    reference: w.reference,
    reviewNote: w.reviewNote,
    createdAt: w.createdAt.toISOString(),
    reviewedAt: w.reviewedAt?.toISOString(),
    paidAt: w.paidAt?.toISOString(),
  };
}

export const walletController = {
  async getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const overview = await walletService.getOverview(req.user!.id);
      res.json({
        wallet: {
          availableBalance: overview.wallet.availableBalance,
          totalEarned: overview.wallet.totalEarned,
        },
        transactions: overview.transactions.map((t) => ({
          id: t._id.toString(),
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          description: t.description,
          meta: t.meta,
          createdAt: t.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  /** GET /api/wallet/transactions?type=&limit= — filtered ledger. */
  async getTransactions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const type = Object.values(TransactionType).includes(req.query.type as TransactionType)
        ? (req.query.type as TransactionType)
        : undefined;
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 30;
      const wallet = await walletService.getOrCreateWallet(req.user!.id);
      const transactions = await walletService.listTransactions(req.user!.id, {
        type,
        limit: Number.isNaN(limit) ? 30 : limit,
      });
      res.json({
        wallet: {
          availableBalance: wallet.availableBalance,
          totalEarned: wallet.totalEarned,
        },
        transactions: transactions.map((t) => ({
          id: t._id.toString(),
          type: t.type,
          amount: t.amount,
          balanceAfter: t.balanceAfter,
          description: t.description,
          meta: t.meta,
          createdAt: t.createdAt.toISOString(),
        })),
      });
    } catch (err) {
      next(err);
    }
  },

  /** GET /api/wallet/instructions — public payment instructions. */
  async getInstructions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ instructions: paymentService.getInstructions() });
    } catch (err) {
      next(err);
    }
  },

    /** POST /api/wallet/deposits — submit a deposit request / initiate Paystack checkout. */
  async createDeposit(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await User.findById(req.user!.id);
      if (!user) throw httpError(404, 'User not found.');

      const deposit = await paymentService.createDeposit(
        req.user!.id,
        req.body.amount,
        req.body.note,
        user.email
      );
      const dto = toDepositDTO(deposit);
      // When Paystack is the provider, the response includes an authorizationUrl
      // so the frontend can redirect the user to complete payment.
      res.status(201).json({ deposit: dto });
    } catch (err) {
      next(err);
    }
  },

  /** GET /api/wallet/deposits?status= */
  async listDeposits(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = Object.values(DepositStatus).includes(req.query.status as DepositStatus)
        ? (req.query.status as DepositStatus)
        : undefined;
      const deposits = await paymentService.listDeposits(req.user!.id, { status });
      res.json({ deposits: deposits.map(toDepositDTO) });
    } catch (err) {
      next(err);
    }
  },

  /** POST /api/wallet/withdrawals — submit a withdrawal request. */
  async createWithdrawal(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const withdrawal = await paymentService.createWithdrawal(req.user!.id, req.body);
      res.status(201).json({ withdrawal: toWithdrawalDTO(withdrawal) });
    } catch (err) {
      next(err);
    }
  },

  /** GET /api/wallet/withdrawals?status= */
  async listWithdrawals(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = Object.values(WithdrawalStatus).includes(req.query.status as WithdrawalStatus)
        ? (req.query.status as WithdrawalStatus)
        : undefined;
      const withdrawals = await paymentService.listWithdrawals(req.user!.id, { status });
      res.json({ withdrawals: withdrawals.map(toWithdrawalDTO) });
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const wallet = await walletService.getOrCreateWallet(req.user!.id);
      const referralEarnings = await walletService.sumByType(
        req.user!.id,
        TransactionType.REFERRAL_COMMISSION
      );
      res.json({
        wallet: {
          availableBalance: wallet.availableBalance,
          totalEarned: wallet.totalEarned,
          referralEarnings,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
