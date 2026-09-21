// src/services/adminService.ts
// Administrative operations: user management and platform statistics.

import { User, AccountStatus, UserRole } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Deposit, DepositStatus } from '../models/Deposit';
import { Withdrawal, WithdrawalStatus } from '../models/Withdrawal';
import { VipPurchase, VipPurchaseStatus } from '../models/VipPurchase';
import { TaskCompletion } from '../models/TaskCompletion';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export interface AdminUserDTO {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: AccountStatus;
  vipLevel: number;
  referralCode: string;
  createdAt: string;
  lastLoginAt?: string;
  availableBalance: number;
}

export const adminService = {
  /** Paginated user list with optional search + status filter. */
  async listUsers(options: {
    search?: string;
    status?: AccountStatus;
    limit?: number;
    skip?: number;
  }): Promise<{ users: AdminUserDTO[]; total: number }> {
    const query: Record<string, unknown> = {};
    if (options.status) query.status = options.status;
    if (options.search) {
      const rx = new RegExp(options.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ fullName: rx }, { email: rx }, { referralCode: rx }];
    }

    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);

    const [users, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(query),
    ]);

    const wallets = await Wallet.find({ userId: { $in: users.map((u) => u._id) } }).select(
      'userId availableBalance'
    );
    const balanceByUser = new Map(wallets.map((w) => [w.userId.toString(), w.availableBalance]));

    return {
      total,
      users: users.map((u) => ({
        id: u._id.toString(),
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        role: u.role,
        status: u.status,
        vipLevel: u.vipLevel ?? 0,
        referralCode: u.referralCode,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString(),
        availableBalance: balanceByUser.get(u._id.toString()) ?? 0,
      })),
    };
  },

  /** Change a user's account status (activate/suspend/deactivate). */
  async setUserStatus(userId: string | Types.ObjectId, status: AccountStatus): Promise<AdminUserDTO> {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    user.status = status;
    await user.save();

    const wallet = await Wallet.findOne({ userId: user._id });
    return {
      id: user._id.toString(),
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      vipLevel: user.vipLevel ?? 0,
      referralCode: user.referralCode,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString(),
      availableBalance: wallet?.availableBalance ?? 0,
    };
  },

  /** Platform-wide counters for the admin dashboard. */
  async getStats() {
    const [
      totalUsers,
      activeUsers,
      suspendedUsers,
      pendingDeposits,
      pendingWithdrawals,
      pendingVipPurchases,
      walletAgg,
      completionsToday,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ status: AccountStatus.ACTIVE }),
      User.countDocuments({ status: AccountStatus.SUSPENDED }),
      Deposit.countDocuments({ status: DepositStatus.PENDING }),
      Withdrawal.countDocuments({ status: WithdrawalStatus.PENDING }),
      VipPurchase.countDocuments({ status: VipPurchaseStatus.PENDING }),
      Wallet.aggregate<{ balance: number; earned: number }>([
        { $group: { _id: null, balance: { $sum: '$availableBalance' }, earned: { $sum: '$totalEarned' } } },
      ]),
      TaskCompletion.countDocuments({
        day: new Date().toISOString().slice(0, 10),
      }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers, suspended: suspendedUsers },
      pending: {
        deposits: pendingDeposits,
        withdrawals: pendingWithdrawals,
        vipPurchases: pendingVipPurchases,
      },
      balances: {
        totalAvailable: walletAgg[0]?.balance ?? 0,
        totalEarned: walletAgg[0]?.earned ?? 0,
      },
      tasks: { completionsToday },
    };
  },
};
