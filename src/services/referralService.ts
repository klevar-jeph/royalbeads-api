// src/services/referralService.ts
// Referral programme.
//
// Users have a `referralCode`; new registrations may store `referredBy`.
// Commission is paid ONCE per referred person, on that person's FIRST
// successful (approved) VIP upgrade:
//   A level (the direct referrer)          12% of the upgrade amount
//   B level (the referrer's referrer)       5% of the upgrade amount
//   C level (one level further up)          3% of the upgrade amount
// Idempotency keys (`ref-upgrade:{tier}:{downlineId}`) make retries/replays
// incapable of double-paying; deposits earn no referral commission.

import { User, IUser } from '../models/User';
import { Transaction, TransactionType } from '../models/Transaction';
import { VipPurchase, VipPurchaseStatus, IVipPurchase } from '../models/VipPurchase';
import { Notification, NotificationType } from '../models/Notification';
import { walletService } from './walletService';
import { Types } from 'mongoose';

/** Commission percentages paid on a downline's first approved VIP upgrade. */
export const UPGRADE_COMMISSION_RATES = { A: 12, B: 5, C: 3 } as const;

export type UpgradeCommissionTier = keyof typeof UPGRADE_COMMISSION_RATES;

export const referralService = {
  /** Whole-Naira commission for an upgrade amount at a tier (floored). */
  commissionFor(amount: number, tier: UpgradeCommissionTier): number {
    return Math.floor((amount * UPGRADE_COMMISSION_RATES[tier]) / 100);
  },

  /**
   * Credit the upline chain (A, B, C) for the buyer's FIRST approved VIP
   * upgrade. Safe to call more than once for the same purchase: the one-time
   * guard skips any buyer who already has an approved upgrade, and every
   * credit carries an idempotency key.
   */
  async creditFirstUpgradeCommission(
    purchase: Pick<IVipPurchase, '_id' | 'userId' | 'amount' | 'levelCode'>
  ): Promise<{ credited: number; total: number }> {
    const downline = await User.findById(purchase.userId).select('referredBy fullName');
    if (!downline?.referredBy) return { credited: 0, total: 0 };

    // One-time rule: only the buyer's FIRST successful upgrade pays commission.
    const priorApproved = await VipPurchase.countDocuments({
      userId: purchase.userId,
      status: VipPurchaseStatus.APPROVED,
      _id: { $ne: purchase._id },
    });
    if (priorApproved > 0) return { credited: 0, total: 0 };

    let credited = 0;
    let total = 0;

    // Walk the chain: A = direct referrer, B = their referrer, C = the next one.
    let uplineId: Types.ObjectId | null | undefined = downline.referredBy;
    const tiers: UpgradeCommissionTier[] = ['A', 'B', 'C'];

    for (const tier of tiers) {
      if (!uplineId) break;
      const upline: IUser | null = await User.findById(uplineId).select(
        '_id referredBy fullName'
      );
      if (!upline) break;

      const amount = referralService.commissionFor(purchase.amount, tier);
      if (amount > 0) {
        const idempotencyKey = `ref-upgrade:${tier}:${purchase.userId.toString()}`;

        // Already credited for this downline? Skip (keeps notification single).
        const existing = await Transaction.findOne({
          userId: upline._id,
          type: TransactionType.REFERRAL_COMMISSION,
          'meta.idempotencyKey': idempotencyKey,
        });

        if (!existing) {
          await walletService.credit(
            upline._id,
            TransactionType.REFERRAL_COMMISSION,
            amount,
            `Referral upgrade commission (${UPGRADE_COMMISSION_RATES[tier]}%) from ${downline.fullName}`,
            {
              idempotencyKey,
              meta: {
                tier,
                percent: UPGRADE_COMMISSION_RATES[tier],
                downlineUserId: purchase.userId.toString(),
                vipPurchaseId: purchase._id.toString(),
                levelCode: purchase.levelCode,
              },
            }
          );

          await Notification.create({
            userId: upline._id,
            type: NotificationType.REFERRAL,
            title: 'Referral commission earned',
            message: `You earned ₦${amount.toLocaleString()} (${UPGRADE_COMMISSION_RATES[tier]}%) from ${downline.fullName}'s first membership upgrade.`,
          }).catch(() => {});

          credited += 1;
          total += amount;
        }
      }

      uplineId = upline.referredBy;
    }

    return { credited, total };
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
      commissionRates: {
        a: UPGRADE_COMMISSION_RATES.A,
        b: UPGRADE_COMMISSION_RATES.B,
        c: UPGRADE_COMMISSION_RATES.C,
      },
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
