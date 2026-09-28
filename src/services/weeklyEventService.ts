// src/services/weeklyEventService.ts
// Weekly Events engine with multi-condition evaluations and rewards (Cash or Lucky Draw spins).

import { User } from '../models/User';
import { WeeklyEvent, EventRewardType } from '../models/WeeklyEvent';

import { WeeklyEventParticipation } from '../models/WeeklyEventParticipation';
import { RewardLedger, RewardFeature } from '../models/RewardLedger';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { luckyDrawService } from './luckyDrawService';
import { Notification, NotificationType } from '../models/Notification';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const weeklyEventService = {
  async listActiveEvents(userId?: string | Types.ObjectId) {
    const now = new Date();
    const events = await WeeklyEvent.find({
      active: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    }).sort({ createdAt: -1 });

    if (!userId) return events.map((e) => ({ event: e, participation: null }));

    const participations = await WeeklyEventParticipation.find({
      userId,
      eventId: { $in: events.map((e) => e._id) },
    });
    const partByEventId = new Map(participations.map((p) => [p.eventId.toString(), p]));

    return events.map((event) => ({
      event,
      participation: partByEventId.get(event._id.toString()) ?? null,
    }));
  },

  async evaluateUserParticipation(userId: string | Types.ObjectId, eventId: string) {
    const event = await WeeklyEvent.findById(eventId);
    if (!event || !event.active) throw httpError(404, 'Event not found or inactive.');

    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    const newReferrals = await User.countDocuments({
      referredBy: user._id,
      createdAt: { $gte: event.startDate, $lte: event.endDate },
    });

    const userLevelRank = user.vipLevel ?? 0;

    const directIds = await User.find({ referredBy: user._id }).distinct('_id');
    const teamMembersCount = directIds.length;

    const qualified =
      newReferrals >= event.requiredReferrals &&
      (!event.requiredLevelRank || userLevelRank >= event.requiredLevelRank) &&
      (!event.requiredTeamMembers || teamMembersCount >= event.requiredTeamMembers);

    let part = await WeeklyEventParticipation.findOne({ userId, eventId: event._id });
    if (!part) {
      part = await WeeklyEventParticipation.create({
        userId,
        eventId: event._id,
        currentReferrals: newReferrals,
        currentLevelRank: userLevelRank,
        currentTeamMembers: teamMembersCount,
        qualified,
      });
    } else {
      part.currentReferrals = newReferrals;
      part.currentLevelRank = userLevelRank;
      part.currentTeamMembers = teamMembersCount;
      if (!part.qualified && qualified) part.qualified = true;
      await part.save();
    }

    return { event, participation: part };
  },

  async claimReward(userId: string | Types.ObjectId, eventId: string) {
    const { event, participation } = await weeklyEventService.evaluateUserParticipation(userId, eventId);

    if (!participation.qualified) {
      throw httpError(400, 'You have not satisfied the conditions for this event.');
    }
    if (participation.rewardClaimed) {
      throw httpError(409, 'Reward already claimed for this event.');
    }

    // Atomically claim one winner slot BEFORE recording the reward so two
    // concurrent claims can never exceed maxWinners.
    const claimedSlot = await WeeklyEvent.findOneAndUpdate(
      { _id: event._id, winnersCount: { $lt: event.maxWinners } },
      { $inc: { winnersCount: 1 } },
      { new: true }
    );
    if (!claimedSlot) {
      throw httpError(400, 'Maximum winners limit reached for this event.');
    }

    const reference = `EVT-${event._id.toString().slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

    participation.rewardClaimed = true;
    participation.rewardReference = reference;
    participation.claimedAt = new Date();
    await participation.save();

    const user = await User.findById(userId);

    if (event.rewardType === EventRewardType.CASH) {
      const tx = await walletService.credit(
        userId,
        TransactionType.WEEKLY_EVENT_REWARD,
        event.rewardAmount,
        `Weekly Event Reward: ${event.title}`,
        { idempotencyKey: reference, meta: { eventId: event._id.toString(), reference } }
      );

      await RewardLedger.create({
        userId,
        userName: user?.fullName ?? 'User',
        feature: RewardFeature.WEEKLY_EVENT,
        rewardType: 'CASH',
        amount: event.rewardAmount,
        reference,
        transactionId: tx._id,
        sourceRecordId: participation._id.toString(),
        status: 'CREDITED',
      });
    } else if (event.rewardType === EventRewardType.LUCKY_DRAW_SPINS) {
      for (let i = 0; i < event.rewardAmount; i++) {
        await luckyDrawService.awardSpinForReferral(
          userId,
          new Types.ObjectId(),
          `Weekly Event Reward: ${event.title}`
        );
      }
    }

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Weekly Event Reward Claimed!',
      message: `You successfully claimed your reward for "${event.title}".`,
    }).catch(() => {});

    return { event, participation };
  },
};
