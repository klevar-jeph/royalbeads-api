// src/services/adminService.ts
// Administrative operations: user management and platform statistics.

import { User, AccountStatus, UserRole, IUser } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { Deposit, DepositStatus } from '../models/Deposit';
import { Withdrawal, WithdrawalStatus } from '../models/Withdrawal';
import { VipPurchase, VipPurchaseStatus } from '../models/VipPurchase';
import { Task, ITask } from '../models/Task';
import { TaskCompletion } from '../models/TaskCompletion';
import { AuditLog } from '../models/AuditLog';
import { Notification, NotificationType } from '../models/Notification';
import { VIP_LEVELS, getLevelByTier } from '../config/vipLevels';
import { sendEmail } from './email';
import { env } from '../config/env';
import { Types } from 'mongoose';

/** Highest configured membership tier (tier 0 is Intern). */
const MAX_VIP_TIER = VIP_LEVELS[VIP_LEVELS.length - 1].tier;

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
  /** Level code from the central catalogue, e.g. INTERN / R1 / MASTER. */
  vipLevelCode: string;
  vipLevelName: string;
  referralCode: string;
  createdAt: string;
  lastLoginAt?: string;
  availableBalance: number;
}

/**
 * Shape the admin-facing user summary. The tier is always resolved through the
 * central level catalogue so tier 0 renders as "INTERN" — never "R0".
 */
function toAdminUserDTO(user: IUser, availableBalance = 0): AdminUserDTO {
  const level = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    vipLevel: level.tier,
    vipLevelCode: level.code,
    vipLevelName: level.name,
    referralCode: user.referralCode,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString(),
    availableBalance,
  };
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
      users: users.map((u) => toAdminUserDTO(u, balanceByUser.get(u._id.toString()) ?? 0)),
    };
  },

  /** Change a user's account status (activate/suspend/deactivate). */
  async setUserStatus(userId: string | Types.ObjectId, status: AccountStatus): Promise<AdminUserDTO> {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    user.status = status;
    await user.save();

    const wallet = await Wallet.findOne({ userId: user._id });
    return toAdminUserDTO(user, wallet?.availableBalance ?? 0);
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

  // --- Audit trail ---------------------------------------------------------

  /**
   * Append an entry to the administrative audit log. Never throws — auditing
   * must not break the mutation it is describing.
   */
  async record(entry: {
    actorId: string | Types.ObjectId;
    actorEmail: string;
    action: string;
    targetType: string;
    targetId?: string;
    meta?: Record<string, unknown>;
    ip?: string;
  }): Promise<void> {
    try {
      await AuditLog.create(entry);
    } catch (err) {
      console.warn('[audit] failed to record admin action', entry.action, err);
    }
  },

  /** Paginated, filterable audit log list (newest first). */
  async listAuditLogs(options: { action?: string; targetId?: string; limit?: number; skip?: number }) {
    const query: Record<string, unknown> = {};
    if (options.action) query.action = options.action;
    if (options.targetId) query.targetId = options.targetId;

    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const skip = Math.max(options.skip ?? 0, 0);

    const [logs, total] = await Promise.all([
      AuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      AuditLog.countDocuments(query),
    ]);

    return {
      total,
      logs: logs.map((l) => ({
        id: l._id.toString(),
        actorEmail: l.actorEmail,
        action: l.action,
        targetType: l.targetType,
        targetId: l.targetId,
        meta: l.meta,
        ip: l.ip,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  },

  // --- User administration --------------------------------------------------

  /** Everything an admin needs about one user, with the ledger READ-ONLY. */
  async getUserDetail(userId: string | Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    const [wallet, transactions, deposits, withdrawals, vipPurchases, completions, referrals] =
      await Promise.all([
        Wallet.findOne({ userId: user._id }),
        Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50),
        Deposit.find({ userId: user._id }).sort({ createdAt: -1 }).limit(25),
        Withdrawal.find({ userId: user._id }).sort({ createdAt: -1 }).limit(25),
        VipPurchase.find({ userId: user._id }).sort({ createdAt: -1 }).limit(25),
        TaskCompletion.countDocuments({ userId: user._id }),
        User.countDocuments({ referredBy: user._id }),
      ]);

    // Resolve the tier through the catalogue so tier 0 reads as INTERN.
    const level = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];

    return {
      user: {
        id: user._id.toString(),
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
        status: user.status,
        vipLevel: level.tier,
        vipLevelCode: level.code,
        vipLevelName: level.name,
        vipActivatedAt: user.vipActivatedAt?.toISOString(),
        referralCode: user.referralCode,
        referredBy: user.referredBy?.toString(),
        lastLoginAt: user.lastLoginAt?.toISOString(),
        createdAt: user.createdAt.toISOString(),
      },
      // Wallet + ledger are exposed read-only: admins never edit balances.
      wallet: {
        availableBalance: wallet?.availableBalance ?? 0,
        totalEarned: wallet?.totalEarned ?? 0,
      },
      transactions: transactions.map((t) => ({
        id: t._id.toString(),
        type: t.type,
        amount: t.amount,
        description: t.description,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt.toISOString(),
      })),
      deposits: deposits.map((d) => ({
        id: d._id.toString(),
        amount: d.amount,
        status: d.status,
        method: d.method,
        reference: d.reference,
        createdAt: d.createdAt.toISOString(),
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w._id.toString(),
        amount: w.amount,
        status: w.status,
        bankName: w.bankName,
        accountNumber: w.accountNumber,
        accountName: w.accountName,
        reference: w.reference,
        reviewNote: w.reviewNote,
        createdAt: w.createdAt.toISOString(),
        payoutEta: w.payoutEta?.toISOString(),
      })),
      vipPurchases: vipPurchases.map((p) => ({
        id: p._id.toString(),
        levelCode: p.levelCode,
        levelName: p.levelName,
        amount: p.amount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      metrics: { taskCompletions: completions, referrals },
    };
  },

  /**
   * Reset a user's password (admin-initiated). The wallet/ledger is untouched;
   * the user is notified in-app and by email.
   */
  async resetUserPassword(
    userId: string | Types.ObjectId,
    newPassword: string
  ): Promise<{ email: string }> {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw httpError(422, 'Password must be at least 8 characters long.');
    }
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    await user.setPassword(newPassword);
    await user.save();

    await Notification.create({
      userId: user._id,
      type: NotificationType.SECURITY,
      title: 'Password changed by support',
      message:
        'An administrator reset your account password. If this was not requested, contact support immediately.',
    });

    try {
      await sendEmail({
        to: user.email,
        subject: 'Your Royalbeads password was reset',
        text: `Your account password was reset by an administrator.\n\nIf you did not request this, contact support immediately.\n\n${env.frontendUrl}`,
      });
    } catch {
      // Best-effort email.
    }

    return { email: user.email };
  },

  /** Change a user's role (SUPER_ADMIN only at the route level). */
  async setUserRole(userId: string | Types.ObjectId, role: UserRole): Promise<AdminUserDTO> {
    if (!Object.values(UserRole).includes(role)) {
      throw httpError(422, `Role must be one of ${Object.values(UserRole).join(', ')}.`);
    }
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    user.role = role;
    await user.save();

    const wallet = await Wallet.findOne({ userId: user._id });
    return toAdminUserDTO(user, wallet?.availableBalance ?? 0);
  },

  /**
   * Update a user's profile fields (admin-initiated). Wallet balances and the
   * ledger are never touched here — money only moves through Paystack
   * deposits, approved withdrawals and engine-credited tasks.
   */
  async updateUserProfile(
    userId: string | Types.ObjectId,
    patch: { fullName?: string; email?: string; phone?: string; avatarUrl?: string }
  ): Promise<AdminUserDTO> {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    if (patch.fullName !== undefined) {
      const fullName = String(patch.fullName).trim();
      if (fullName.length < 2 || fullName.length > 80) {
        throw httpError(422, 'Full name must be between 2 and 80 characters.');
      }
      user.fullName = fullName;
    }

    if (patch.email !== undefined) {
      const email = String(patch.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw httpError(422, 'Enter a valid email address.');
      }
      const clash = await User.findOne({ email, _id: { $ne: user._id } }).select('_id');
      if (clash) throw httpError(409, 'Another account already uses that email address.');
      user.email = email;
    }

    if (patch.phone !== undefined) {
      const phone = String(patch.phone).trim();
      if (phone.length > 24) throw httpError(422, 'Phone number must be at most 24 characters.');
      user.phone = phone || undefined;
    }

    if (patch.avatarUrl !== undefined) {
      const avatarUrl = String(patch.avatarUrl).trim();
      if (avatarUrl.length > 2048) throw httpError(422, 'Avatar URL is too long.');
      user.avatarUrl = avatarUrl || undefined;
    }

    await user.save();

    const wallet = await Wallet.findOne({ userId: user._id });
    return toAdminUserDTO(user, wallet?.availableBalance ?? 0);
  },

  /**
   * Move a user to another membership tier (admin override). The tier is
   * validated against the central catalogue (tier 0 is Intern) and the user is
   * notified in-app.
   */
  async setUserVipLevel(userId: string | Types.ObjectId, tier: number): Promise<AdminUserDTO> {
    const level = getLevelByTier(Math.round(Number(tier)));
    if (!level) {
      const top = VIP_LEVELS[VIP_LEVELS.length - 1];
      throw httpError(
        422,
        `Tier must be between 0 (${VIP_LEVELS[0].code}) and ${top.tier} (${top.code}).`
      );
    }

    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    user.vipLevel = level.tier;
    user.vipActivatedAt = new Date();
    await user.save();

    await Notification.create({
      userId: user._id,
      type: NotificationType.VIP,
      title: 'Membership level updated',
      message: `An administrator set your membership level to ${level.code} (${level.name}).`,
    });

    const wallet = await Wallet.findOne({ userId: user._id });
    return toAdminUserDTO(user, wallet?.availableBalance ?? 0);
  },

  // --- Task administration --------------------------------------------------

  /** All task definitions (including inactive) for the admin table. */
  async listTasks(): Promise<ITask[]> {
    return Task.find({}).sort({ sortOrder: 1, createdAt: 1 });
  },

  /** Create a task definition. */
  async createTask(input: {
    key: string;
    title: string;
    description: string;
    reward: number;
    minVipTier?: number;
    dailyLimit?: number;
    active?: boolean;
    sortOrder?: number;
  }): Promise<ITask> {
    const key = String(input.key ?? '').trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(key)) {
      throw httpError(422, 'Key must be 3–40 characters: lowercase letters, numbers and dashes.');
    }
    if (!input.title || !input.description) {
      throw httpError(422, 'Title and description are required.');
    }
    const reward = Math.round(Number(input.reward));
    if (!Number.isFinite(reward) || reward < 0) {
      throw httpError(422, 'Reward must be a non-negative whole number.');
    }

    const existing = await Task.findOne({ key });
    if (existing) throw httpError(409, `A task with key "${key}" already exists.`);

    return Task.create({
      key,
      title: input.title,
      description: input.description,
      reward,
      minVipTier: Math.min(Math.max(Math.round(Number(input.minVipTier ?? 0)), 0), MAX_VIP_TIER),
      dailyLimit: Math.min(Math.max(Math.round(Number(input.dailyLimit ?? 1)), 1), 50),
      active: input.active ?? true,
      sortOrder: Math.round(Number(input.sortOrder ?? 0)),
    });
  },

  /** Patch a task definition (reward, VIP gate, daily limit, active, order). */
  async updateTask(
    key: string,
    patch: Partial<{
      title: string;
      description: string;
      reward: number;
      minVipTier: number;
      dailyLimit: number;
      active: boolean;
      sortOrder: number;
    }>
  ): Promise<ITask> {
    const task = await Task.findOne({ key });
    if (!task) throw httpError(404, 'Task not found.');

    if (patch.title !== undefined) task.title = patch.title;
    if (patch.description !== undefined) task.description = patch.description;
    if (patch.reward !== undefined) {
      const reward = Math.round(Number(patch.reward));
      if (!Number.isFinite(reward) || reward < 0) {
        throw httpError(422, 'Reward must be a non-negative whole number.');
      }
      task.reward = reward;
    }
    if (patch.minVipTier !== undefined) {
      task.minVipTier = Math.min(Math.max(Math.round(Number(patch.minVipTier)), 0), MAX_VIP_TIER);
    }
    if (patch.dailyLimit !== undefined) {
      task.dailyLimit = Math.min(Math.max(Math.round(Number(patch.dailyLimit)), 1), 50);
    }
    if (patch.active !== undefined) task.active = Boolean(patch.active);
    if (patch.sortOrder !== undefined) task.sortOrder = Math.round(Number(patch.sortOrder));

    await task.save();
    return task;
  },

  /** Delete a task definition (completion history is retained). */
  async deleteTask(key: string): Promise<{ key: string }> {
    const task = await Task.findOneAndDelete({ key });
    if (!task) throw httpError(404, 'Task not found.');
    return { key: task.key };
  },
};
