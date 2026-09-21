// src/services/referralService.ts
// Referral programme.
//
// Users have a `referralCode`; new registrations may store `referredBy`.
// A commission (env: REFERRAL_COMMISSION_PERCENT, default 5%) is credited to
// the referrer when a downline's deposit is approved — idempotently, keyed by
// the deposit id so retries/replays cannot double-pay.

import { User } from '../models/User';
import { Transaction, TransactionType } from '../models/Transaction';
import { Notification, NotificationType } from '../models/Notification';
import { walletService } from './walletService';
import { env } from '../config/env';
import { Types } from 'mongoose';

/** Whole-Naira commission for a deposit amount (floored). */
export function commissionFor(amount: number, percent = env.referralCommissionPercent): number {
  return Math.floor((amount * percent) / 100);
}

export const referralService = {
  /** Percentage currently applied to qualifying deposits. */
  getCommissionPercent(): number {
    return env.referralCommissionPercent;
  },

  /**
   * Credit the referrer for a qualifying deposit. Safe to call more than once
   * for the same deposit (idempotency key = deposit id).
   */
  async creditReferralCommission(
    downlineUserId: string | Types.ObjectId,
    depositId: string | Types.ObjectId,
    depositAmount: number
  ): Promise<{ credited: boolean; amount: number }> {
    const downline = await User.findById(downlineUserId).select('referredBy fullName');
    if (!downline?.referredBy) return { credited: false, amount: 0 };

    const amount = commissionFor(depositAmount);
    if (amount <= 0) return { credited: false, amount: 0 };

    const idempotencyKey = `referral:${depositId}`;

    // Already credited for this deposit?
    const existing = await Transaction.findOne({
      userId: downline.referredBy,
      type: TransactionType.REFERRAL_COMMISSION,
      'meta.idempotencyKey': idempotencyKey,
    });
    if (existing) return { credited: false, amount };

    await walletService.credit(
      downline.referredBy,
      TransactionType.REFERRAL_COMMISSION,
      amount,
      `Referral commission from ${downline.fullName}`,
      {
        idempotencyKey,
        meta: {
          depositId: depositId.toString(),
          downlineUserId: downlineUserId.toString(),
          percent: env.referralCommissionPercent,
        },
      }
    );

    await Notification.create({
      userId: downline.referredBy,
      type: NotificationType.REFERRAL,
      title: 'Referral commission earned',
      message: `You earned ₦${amount.toLocaleString()} (${env.referralCommissionPercent}%) from a referred member's deposit.`,
    });

    return { credited: true, amount };
  },

  /** The referrer's dashboard: code, share link, downlines, earnings. */
  async getSummary(userId: string | Types.ObjectId) {
    const user = await User.findById(userId).select('referralCode');
    if (!user) return null;

    const downlines = await User.find({ referredBy: user._id })
      .select('fullName email status vipLevel createdAt')
      .sort({ createdAt: -1 })
      .limit(200);

    const earnings = await walletService.sumByType(userId, TransactionType.REFERRAL_COMMISSION);

    const siteUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

    return {
      referralCode: user.referralCode,
      shareLink: `${siteUrl}/register?ref=${user.referralCode}`,
      commissionPercent: env.referralCommissionPercent,
      earnings,
      total: downlines.length,
      active: downlines.filter((d) => d.status === 'ACTIVE').length,
      downlines: downlines.map((d) => ({
        id: d._id.toString(),
        fullName: d.fullName,
        email: d.email,
        status: d.status,
        vipLevel: d.vipLevel ?? 0,
        joinedAt: d.createdAt.toISOString(),
      })),
    };
  },
};
