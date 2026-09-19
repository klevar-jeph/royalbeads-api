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
import { VIP_LEVELS, getLevelByCode, getLevelByTier, levelsAbove, VipLevelConfig } from '../config/vipLevels';
import { VipLevelDTO, VipStatusDTO, VipPurchaseDTO } from '../types/dto';
import { Types } from 'mongoose';

function toLevelDTO(level: VipLevelConfig): VipLevelDTO {
  return {
    id: level.id,
    code: level.code,
    name: level.name,
    investment: level.investment,
    dailyReturn: level.dailyReturn,
    tier: level.tier,
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

export const vipService = {
  /** All configured levels, ascending. */
  listLevels(): VipLevelDTO[] {
    return VIP_LEVELS.map(toLevelDTO);
  },

  /** The current user's VIP status: level, next level, pending purchase. */
  async getStatus(userId: string | Types.ObjectId): Promise<VipStatusDTO | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const currentLevel = getLevelByTier(user.vipLevel ?? 0) ?? VIP_LEVELS[0];
    const nextLevel = levelsAbove(currentLevel.tier)[0];

    const pending = await VipPurchase
      .findOne({ userId: user._id, status: VipPurchaseStatus.PENDING })
      .sort({ createdAt: -1 });

    return {
      current: toLevelDTO(currentLevel),
      next: nextLevel ? toLevelDTO(nextLevel) : undefined,
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
      throw httpError(400, `You are already on ${getLevelByTier(currentTier)?.code ?? 'R0'} or higher.`);
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
