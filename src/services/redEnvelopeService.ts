// src/services/redEnvelopeService.ts
// Red Envelope Campaign and Claim engine.
import { User } from '../models/User';
import { RedEnvelopeCampaign, IRedEnvelopeCampaign } from '../models/RedEnvelopeCampaign';
import { RedEnvelopeClaim, IRedEnvelopeClaim } from '../models/RedEnvelopeClaim';
import { RewardLedger, RewardFeature } from '../models/RewardLedger';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { Notification, NotificationType } from '../models/Notification';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const redEnvelopeService = {
  async createCampaign(input: {
    title: string;
    claimCode: string;
    totalBudget: number;
    maxWinners: number;
    minAmount: number;
    maxAmount: number;
    isRandom?: boolean;
    startDate: Date;
    endDate: Date;
    createdBy?: Types.ObjectId | string;
  }): Promise<IRedEnvelopeCampaign> {
    const code = input.claimCode.trim().toUpperCase();
    const existing = await RedEnvelopeCampaign.findOne({ claimCode: code });
    if (existing) throw httpError(409, `Campaign with claim code ${code} already exists.`);

    return RedEnvelopeCampaign.create({
      title: input.title,
      claimCode: code,
      totalBudget: input.totalBudget,
      remainingBudget: input.totalBudget,
      maxWinners: input.maxWinners,
      remainingClaims: input.maxWinners,
      minAmount: input.minAmount,
      maxAmount: input.maxAmount,
      isRandom: input.isRandom ?? true,
      active: true,
      startDate: input.startDate,
      endDate: input.endDate,
      createdBy: input.createdBy,
    });
  },

  async claim(userId: string | Types.ObjectId, code: string): Promise<IRedEnvelopeClaim> {
    const cleanCode = code.trim().toUpperCase();
    const campaign = await RedEnvelopeCampaign.findOne({ claimCode: cleanCode });
    if (!campaign) throw httpError(404, 'Invalid Red Envelope claim code.');
    if (!campaign.active) throw httpError(400, 'This Red Envelope campaign is inactive.');

    const now = new Date();
    if (now < campaign.startDate || now > campaign.endDate) {
      throw httpError(400, 'This Red Envelope campaign is outside its active period.');
    }
    if (campaign.remainingClaims <= 0 || campaign.remainingBudget <= 0) {
      throw httpError(400, 'All Red Envelopes for this campaign have already been claimed.');
    }

    const hasClaimed = await RedEnvelopeClaim.findOne({ campaignId: campaign._id, userId });
    if (hasClaimed) throw httpError(409, 'You have already claimed this Red Envelope.');

    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    let claimAmount: number;
    if (campaign.remainingClaims === 1) {
      claimAmount = Math.min(campaign.remainingBudget, campaign.maxAmount);
    } else if (!campaign.isRandom) {
      claimAmount = Math.min(Math.floor(campaign.totalBudget / campaign.maxWinners), campaign.remainingBudget);
    } else {
      const minPossible = campaign.minAmount;
      const maxPossible = Math.min(
        campaign.maxAmount,
        campaign.remainingBudget - (campaign.remainingClaims - 1) * campaign.minAmount
      );
      claimAmount = maxPossible < minPossible ? minPossible : Math.floor(Math.random() * (maxPossible - minPossible + 1)) + minPossible;
    }

    if (claimAmount > campaign.remainingBudget) claimAmount = campaign.remainingBudget;
    if (claimAmount <= 0) throw httpError(400, 'Campaign budget exhausted.');

    const reference = `ENV-${cleanCode}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const updatedCampaign = await RedEnvelopeCampaign.findOneAndUpdate(
      { _id: campaign._id, remainingClaims: { $gt: 0 }, remainingBudget: { $gte: claimAmount } },
      { $inc: { remainingClaims: -1, remainingBudget: -claimAmount } },
      { new: true }
    );
    if (!updatedCampaign) throw httpError(409, 'Could not allocate reward. Budget or claim limit exceeded.');

    let claim: IRedEnvelopeClaim;
    try {
      claim = await RedEnvelopeClaim.create({ campaignId: campaign._id, userId, amount: claimAmount, reference });
    } catch {
      await RedEnvelopeCampaign.updateOne({ _id: campaign._id }, { $inc: { remainingClaims: 1, remainingBudget: claimAmount } });
      throw httpError(409, 'You have already claimed this Red Envelope.');
    }

    try {
      const tx = await walletService.credit(
        userId,
        TransactionType.RED_ENVELOPE_REWARD,
        claimAmount,
        `Red Envelope: ${campaign.title} (${cleanCode})`,
        { idempotencyKey: reference, meta: { campaignId: campaign._id.toString(), reference } }
      );

      await RewardLedger.create({
        userId,
        userName: user.fullName,
        feature: RewardFeature.RED_ENVELOPE,
        rewardType: 'CASH',
        amount: claimAmount,
        reference,
        transactionId: tx._id,
        sourceRecordId: claim._id.toString(),
        status: 'CREDITED',
      });
    } catch (err) {
      console.error('[redEnvelopeService] Credit wallet error:', err);
    }

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Red Envelope Claimed!',
      message: `You successfully claimed ₦${claimAmount.toLocaleString()} from "${campaign.title}"!`,
    }).catch(() => {});

    return claim;
  },

  async listUserClaims(userId: string | Types.ObjectId) {
    return RedEnvelopeClaim.find({ userId }).populate('campaignId', 'title claimCode').sort({ claimedAt: -1 });
  },

  async listCampaigns() {
    return RedEnvelopeCampaign.find({}).sort({ createdAt: -1 });
  },
};
