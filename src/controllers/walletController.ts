// src/controllers/walletController.ts
// Thin HTTP controllers for wallet endpoints.

import { Request, Response, NextFunction } from 'express';
import { walletService } from '../services/walletService';
import { TransactionType } from '../models/Transaction';

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
