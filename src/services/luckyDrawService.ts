// src/services/luckyDrawService.ts
// Lucky Draw prize engine with weighted random selection and referral spin entitlements.

import { User } from '../models/User';
import { LuckyDrawPrize, ILuckyDrawPrize } from '../models/LuckyDrawPrize';
import { LuckyDrawEntitlement, EntitlementStatus } from '../models/LuckyDrawEntitlement';
import { LuckyDrawSpin } from '../models/LuckyDrawSpin';
import { RewardLedger, RewardFeature } from '../models/RewardLedger';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { bootstrapService } from './bootstrapService';
import { systemSettingService } from './systemSettingService';
import { Notification, NotificationType } from '../models/Notification';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const luckyDrawService = {
  async awardSpinForReferral(
    referrerId: string | Types.ObjectId,
    referredUserId: string | Types.ObjectId,
    conditionDescription = 'Qualifying Direct Referral'
  ): Promise<boolean> {
    const existing = await LuckyDrawEntitlement.findOne({ referrerId, referredUserId });
    if (existing) return false;

    try {
      await LuckyDrawEntitlement.create({
        referrerId,
        referredUserId,
        conditionDescription,
        status: EntitlementStatus.AWARDED,
      });

      await Notification.create({
        userId: referrerId,
        type: NotificationType.SYSTEM,
        title: 'Lucky Draw spin awarded!',
        message: 'You received a free Lucky Draw spin for referring a new member.',
      }).catch(() => {});

      return true;
    } catch {
      return false;
    }
  },

  async getOverview(userId: string | Types.ObjectId) {
    await bootstrapService.bootstrapLuckyDrawPrizes();

    const availableSpins = await LuckyDrawEntitlement.countDocuments({
      referrerId: userId,
      status: EntitlementStatus.AWARDED,
    });

    const prizes = await LuckyDrawPrize.find({ active: true }).sort({ sortOrder: 1 });
    const history = await LuckyDrawSpin.find({ userId }).sort({ createdAt: -1 }).limit(20);

    return {
      availableSpins,
      prizes: prizes.map((p) => ({
        id: p._id.toString(),
        label: p.label,
        amount: p.amount,
        color: p.color,
      })),
      history,
    };
  },

  async spin(userId: string | Types.ObjectId): Promise<{ prize: ILuckyDrawPrize; reference: string; spinId: string }> {
    const isAudit = await systemSettingService.isAuditModeActive();
    if (isAudit) {
      const settings = await systemSettingService.getSettings();
      if (settings.auditDisableTaskRewards) {
        throw httpError(403, 'Lucky Draw is temporarily suspended for system audit.');
      }
    }

    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    const entitlement = await LuckyDrawEntitlement.findOneAndUpdate(
      { referrerId: userId, status: EntitlementStatus.AWARDED },
      { $set: { status: EntitlementStatus.CONSUMED, consumedAt: new Date() } },
      { new: true }
    );

    if (!entitlement) {
      throw httpError(400, 'You have no available Lucky Draw spins. Invite friends to earn spins!');
    }

    const prizes = await LuckyDrawPrize.find({ active: true }).sort({ sortOrder: 1 });
    if (prizes.length === 0) {
      await LuckyDrawEntitlement.updateOne(
        { _id: entitlement._id },
        { $set: { status: EntitlementStatus.AWARDED }, $unset: { consumedAt: 1 } }
      );
      throw httpError(500, 'Lucky Draw prize pool is currently unavailable.');
    }

    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
    const randomVal = Math.random() * totalWeight;
    let runningWeight = 0;
    let selectedPrize: ILuckyDrawPrize = prizes[0];

    for (const p of prizes) {
      runningWeight += p.weight;
      if (randomVal <= runningWeight) {
        selectedPrize = p;
        break;
      }
    }

    const reference = `SPIN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const spinRecord = await LuckyDrawSpin.create({
      userId,
      reference,
      prizeId: selectedPrize._id,
      prizeLabel: selectedPrize.label,
      prizeAmount: selectedPrize.amount,
      entitlementId: entitlement._id,
    });

    entitlement.spinReference = reference;
    await entitlement.save();

    if (selectedPrize.amount > 0) {
      try {
        const tx = await walletService.credit(
          userId,
          TransactionType.LUCKY_DRAW_REWARD,
          selectedPrize.amount,
          `Lucky Draw Win: ${selectedPrize.label}`,
          { idempotencyKey: reference, meta: { prizeId: selectedPrize._id.toString(), spinReference: reference } }
        );

        await RewardLedger.create({
          userId,
          userName: user.fullName,
          feature: RewardFeature.LUCKY_DRAW,
          rewardType: 'CASH',
          amount: selectedPrize.amount,
          reference,
          transactionId: tx._id,
          sourceRecordId: spinRecord._id.toString(),
          status: 'CREDITED',
        });
      } catch (err) {
        console.error('[luckyDrawService] Wallet credit error:', err);
      }
    }

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Lucky Draw Result',
      message: `You won ${selectedPrize.label} from your Lucky Draw spin!`,
    }).catch(() => {});

    return { prize: selectedPrize, reference, spinId: spinRecord._id.toString() };
  },
};
