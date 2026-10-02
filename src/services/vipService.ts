// src/services/vipService.ts
// VIP progression service – level listing, current status, upgrade requests
// and administrative approval/rejection.
//
// Money handling is deliberately NOT done here: purchases are recorded as
// PENDING and activated after payment confirmation (bank transfer reviewed by
// an admin, or a gateway webhook in the wallet phase).

import { User } from '../models/User';
import { VipPurchase, VipPurchaseStatus, IVipPurchase } from '../models/VipPurchase';
import { Notification, NotificationType } from '../models/Notification';
import {
  VIP_LEVELS,
  getLevelByCode,
  getLevelByTier,
  LOCKED_BY_DEFAULT_FROM_TIER,
  VipLevelConfig,
} from '../config/vipLevels';
import { VipLevelDTO, VipStatusDTO, VipPurchaseDTO } from '../types/dto';
import { LevelConfig } from '../models/LevelConfig';
import { levelService } from './levelService';
import { Types } from 'mongoose';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { env } from '../config/env';
import { paystackService } from './paystackService';
import { referralService } from './referralService';

function toLevelDTO(level: VipLevelConfig): VipLevelDTO {
  return {
    id: level.id,
    code: level.code,
    name: level.name,
    investment: level.investment,
    dailyReturn: level.dailyReturn,
    tier: level.tier,
    taskCount: level.taskCount,
    taskReward: level.taskReward,
    description: level.description,
    status: level.status,
  };
}

function toPurchaseDTO(purchase: IVipPurchase): VipPurchaseDTO {
  return {
    id: purchase._id.toString(),
    levelCode: purchase.levelCode,
    levelName: purchase.levelName,
    amount: purchase.amount,
    status: purchase.status,
    reviewNote: purchase.reviewNote,
    createdAt: purchase.createdAt.toISOString(),
    reviewedAt: purchase.reviewedAt?.toISOString(),
  };
}

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/**
 * Catalogue with the admin-controlled open/locked status merged in.
 * The database status (managed per level from the admin dashboard) wins over
 * the static catalogue, so R4+ read as closed until an admin opens them.
 */
async function loadCatalogue(): Promise<VipLevelDTO[]> {
  const configs = await LevelConfig.find({}).select(
    'code status temporaryOpen temporaryOpenStart temporaryOpenEnd'
  );
  const byCode = new Map(configs.map((config) => [config.code, config]));

  return VIP_LEVELS.map((level) => {
    const dto = toLevelDTO(level);
    const config = byCode.get(level.code);
    if (config) {
      if (!levelService.isLevelAccessible(config)) dto.status = 'locked';
    } else if (level.tier >= LOCKED_BY_DEFAULT_FROM_TIER) {
      // Launch default when the level is not configured in the database yet.
      dto.status = 'locked';
    }
    return dto;
  });
}

export const vipService = {
  /** All configured levels, ascending, with live open/locked status. */
  async listLevels(): Promise<VipLevelDTO[]> {
    return loadCatalogue();
  },

  /** The current user's VIP status: level, next level, pending purchase. */
  async getStatus(userId: string | Types.ObjectId): Promise<VipStatusDTO | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const currentLevel = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];
    // "Next" points at the first level the user can actually enter — locked
    // tiers above it stay visible in the catalogue but are not offered as next.
    const nextLevel = (await loadCatalogue()).find(
      (candidate) => candidate.tier > currentLevel.tier && candidate.status !== 'locked'
    );

    const pending = await VipPurchase
      .findOne({ userId: user._id, status: VipPurchaseStatus.PENDING })
      .sort({ createdAt: -1 });

    return {
      current: toLevelDTO(currentLevel),
      next: nextLevel,
      activatedAt: user.vipActivatedAt?.toISOString(),
      pendingPurchase: pending ? toPurchaseDTO(pending) : undefined,
    };
  },

  /** The user's purchase history, newest first. */
  async listPurchases(userId: string | Types.ObjectId, limit = 20): Promise<VipPurchaseDTO[]> {
    const purchases = await VipPurchase
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100));
    return purchases.map(toPurchaseDTO);
  },

  /**
   * Request an upgrade to a higher level. Creates a PENDING purchase that an
   * administrator reviews after payment confirmation.
   */
  async requestUpgrade(
    userId: string | Types.ObjectId,
    levelCode: string
  ): Promise<VipPurchaseDTO> {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    const level = getLevelByCode(levelCode);
    if (!level) throw httpError(404, 'VIP level not found.');
    if (level.status !== 'active') throw httpError(400, 'This VIP level is not currently available.');

    const currentTier = user.vipLevel ?? 0;
    if (level.tier <= currentTier) {
      throw httpError(400, `You are already on ${getLevelByTier(currentTier)?.code ?? VIP_LEVELS[0].code} or higher.`);
    }

    // Launch access control: upgrades may only target a level the admin has
    // opened. R4 and above ship locked and are opened from the admin console.
    const levelConfig = await LevelConfig.findOne({ code: level.code }).select(
      'status temporaryOpen temporaryOpenStart temporaryOpenEnd'
    );
    const open = levelConfig
      ? levelService.isLevelAccessible(levelConfig)
      : level.tier < LOCKED_BY_DEFAULT_FROM_TIER;
    if (!open) {
      throw httpError(403, `${level.code} is locked and not open for upgrades right now.`);
    }

    const existing = await VipPurchase.findOne({
      userId: user._id,
      status: VipPurchaseStatus.PENDING,
    });
    if (existing) throw httpError(409, 'You already have a pending VIP upgrade request.');

    const purchase = await VipPurchase.create({
      userId: user._id,
      levelTier: level.tier,
      levelCode: level.code,
      levelName: level.name,
      amount: level.investment,
      status: VipPurchaseStatus.PENDING,
    });

    await Notification.create({
      userId: user._id,
      type: NotificationType.VIP,
      title: 'VIP upgrade requested',
      message: `Your request to upgrade to ${level.code} (${level.name}) has been received and is awaiting payment confirmation.`,
    });

    return toPurchaseDTO(purchase);
  },

  /** Cancel the user's own pending purchase. */
  async cancelPending(userId: string | Types.ObjectId): Promise<void> {
    const result = await VipPurchase.updateOne(
      { userId, status: VipPurchaseStatus.PENDING },
      { $set: { status: VipPurchaseStatus.REJECTED, reviewNote: 'Cancelled by user.', reviewedAt: new Date() } }
    );
    if (result.matchedCount === 0) throw httpError(404, 'No pending VIP upgrade request found.');
  },

  /**
   * Administrative approval: activates the level on the user and records the
   * decision. (Exposed to admin routes in the admin phase; service-level now.)
   */
  async reviewPurchase(
    purchaseId: string | Types.ObjectId,
    reviewerId: string | Types.ObjectId,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ): Promise<VipPurchaseDTO> {
    const purchase = await VipPurchase.findById(purchaseId);
    if (!purchase) throw httpError(404, 'VIP purchase not found.');
    if (purchase.status !== VipPurchaseStatus.PENDING) {
      throw httpError(409, 'This purchase has already been reviewed.');
    }

    if (decision === 'APPROVE' && purchase.amount > 0) {
      // Automatic platform collection is OPTIONAL and must never block an
      // approval. When the platform recipient is configured AND the user has
      // enough balance, the membership fee is collected through Paystack
      // immediately. Otherwise the approval proceeds and the platform settles
      // the fee out-of-band (the historical admin-verified flow).
      let deferred = false;
      if (!env.payments.paystackPlatformRecipientCode) {
        deferred = true;
      } else {
        const wallet = await walletService.getOrCreateWallet(purchase.userId);
        if (wallet.availableBalance < purchase.amount) {
          deferred = true;
        } else {
          await walletService.debit(
            purchase.userId,
            TransactionType.VIP_PURCHASE,
            purchase.amount,
            `Membership upgrade payment: ${purchase.levelCode}`,
            { meta: { vipPurchaseId: purchase._id.toString(), levelCode: purchase.levelCode } }
          );
          try {
            const payment = await paystackService.transfer({
              amountNaira: purchase.amount,
              recipientCode: env.payments.paystackPlatformRecipientCode,
              reference: `VIP-${purchase._id.toString()}`,
              reason: `Royalbeads membership upgrade ${purchase.levelCode}`,
            });
            if (payment.status === 'failed' || payment.status === 'reversed') {
              throw httpError(502, 'Paystack rejected the membership payment.');
            }
            await VipPurchase.updateOne(
              { _id: purchase._id },
              { $set: { paystackReference: payment.reference } }
            );
          } catch (error) {
            await walletService.credit(
              purchase.userId,
              TransactionType.ADJUSTMENT,
              purchase.amount,
              `Refund: Paystack membership payment failed (${purchase.levelCode})`,
              { idempotencyKey: `vip-refund-${purchase._id.toString()}` }
            );
            throw error;
          }
        }
      }
      if (deferred) {
        // Record that the platform fee is still to be reconciled manually.
        note = [note, 'Platform membership fee pending manual settlement.']
          .filter(Boolean)
          .join(' — ');
      }
    }

    purchase.status =
      decision === 'APPROVE' ? VipPurchaseStatus.APPROVED : VipPurchaseStatus.REJECTED;
    purchase.reviewedBy = new Types.ObjectId(reviewerId.toString());
    purchase.reviewNote = note;
    purchase.reviewedAt = new Date();
    await purchase.save();

    if (decision === 'APPROVE') {
      await User.updateOne(
        { _id: purchase.userId },
        { $set: { vipLevel: purchase.levelTier, vipActivatedAt: new Date() } }
      );
      await Notification.create({
        userId: purchase.userId,
        type: NotificationType.VIP,
        title: 'VIP level activated',
        message: `Congratulations! Your ${purchase.levelCode} (${purchase.levelName}) membership is now active.`,
      });

      // Referral programme: 12% / 5% / 3% to the A / B / C uplines for this
      // buyer's FIRST successful upgrade — never blocks the approval itself.
      try {
        await referralService.creditFirstUpgradeCommission(purchase);
      } catch (error) {
        console.error('[vipService] referral upgrade commission failed:', error);
      }
    } else {
      await Notification.create({
        userId: purchase.userId,
        type: NotificationType.VIP,
        title: 'VIP upgrade rejected',
        message: note
          ? `Your ${purchase.levelCode} upgrade request was rejected: ${note}`
          : `Your ${purchase.levelCode} upgrade request was rejected.`,
      });
    }

    return toPurchaseDTO(purchase);
  },
};
