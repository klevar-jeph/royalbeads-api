// src/services/dashboardService.ts
// Dashboard service – assembles the dashboard summary for the authenticated
// user: real wallet balances, VIP level, daily task counters, referral
// placeholders and unread notification count.

import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { DashboardSummaryDTO } from '../types/dto';
import { getLevelByTier, VIP_LEVELS } from '../config/vipLevels';
import { walletService } from './walletService';
import { taskService } from './taskService';
import { TransactionType } from '../models/Transaction';
import { Types } from 'mongoose';

export const dashboardService = {
  async getDashboardSummary(userId: string | Types.ObjectId): Promise<DashboardSummaryDTO | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const unread = await Notification.countDocuments({ userId, read: false });

    // --- VIP (Phase 4): real level from the user record --------------------
    const vipLevel = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];

    // --- Wallet + tasks (Phase 5): real balances and today's tasks ---------
    const [wallet, referralEarnings, taskList] = await Promise.all([
      walletService.getOrCreateWallet(userId),
      walletService.sumByType(userId, TransactionType.REFERRAL_COMMISSION),
      taskService.listForUser(userId),
    ]);

    return {
      user: {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        referralCode: user.referralCode,
        emailVerified: true,
      },
      // --- Wallet: real balances (Phase 5) ---------------------------------
      availableBalance: wallet.availableBalance,
      totalEarnings: wallet.totalEarned,
      // Deposits/withdrawals arrive with the payments phase (Phase 6).
      totalDeposits: 0,
      totalWithdrawals: 0,
      referralEarnings,
      // --- VIP: real level (Phase 4) --------------------------------------
      vip: {
        level: vipLevel.code,
        levelName: vipLevel.name,
        tier: vipLevel.tier,
      },
      // --- Tasks: real daily counters (Phase 5) ----------------------------
      tasks: {
        available: taskList.items.filter((t) => t.remainingToday > 0).length,
        completed: taskList.completedToday,
      },
      // --- Referral placeholder -------------------------------------------
      referrals: {
        total: 0,
        active: 0,
      },
      // --- Notification count ---------------------------------------------
      notifications: {
        unread,
      },
    };
  },
};
