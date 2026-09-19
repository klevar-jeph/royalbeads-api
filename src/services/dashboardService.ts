// src/services/dashboardService.ts
// Dashboard service – assembles the dashboard summary for the authenticated
// user.
//
// Financial fields are deliberately zero until the wallet/ledger phase. We do
// NOT fabricate balances, earnings, or transactions. The structure is ready
// for future phases to plug real values in.

import { User, AccountStatus } from '../models/User';
import { Notification } from '../models/Notification';
import { DashboardSummaryDTO } from '../types/dto';
import { getLevelByTier, VIP_LEVELS } from '../config/vipLevels';
import { Types } from 'mongoose';

export const dashboardService = {
  async getDashboardSummary(userId: string | Types.ObjectId): Promise<DashboardSummaryDTO | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const unread = await Notification.countDocuments({ userId, read: false });

    // --- VIP (Phase 4): real level from the user record --------------------
    const vipLevel = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];

    return {
      user: {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        referralCode: user.referralCode,
        emailVerified: user.status === AccountStatus.ACTIVE,
      },
      // --- Financial placeholders (Phase 3) --------------------------------
      // These remain zero until the wallet/ledger service exists. Do not
      // populate with fake values.
      availableBalance: 0,
      totalEarnings: 0,
      totalDeposits: 0,
      totalWithdrawals: 0,
      referralEarnings: 0,
      // --- VIP: real level (Phase 4) --------------------------------------
      vip: {
        level: vipLevel.code,
        levelName: vipLevel.name,
        tier: vipLevel.tier,
      },
      // --- Task placeholder -----------------------------------------------
      tasks: {
        available: 0,
        completed: 0,
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
