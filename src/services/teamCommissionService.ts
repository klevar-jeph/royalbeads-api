// src/services/teamCommissionService.ts
// Team Commission System (A-Level: 5%, B-Level: 2%, C-Level: 1%).
import { User } from '../models/User';
import { Transaction, TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { Notification, NotificationType } from '../models/Notification';
import { LevelConfig } from '../models/LevelConfig';
import { Types } from 'mongoose';

export const COMMISSION_RATES = { A: 0.05, B: 0.02, C: 0.01 };

export const teamCommissionService = {
  async distributeTaskCommissions(
    memberUserId: Types.ObjectId | string,
    taskReward: number,
    completionId: string,
    taskTitle: string
  ): Promise<void> {
    if (taskReward <= 0) return;
    const member = await User.findById(memberUserId).select('referredBy fullName');
    if (!member?.referredBy) return;

    // Tier A (5%)
    const userA = await User.findById(member.referredBy).select('_id referredBy fullName');
    if (!userA) return;
    const commA = Math.floor(taskReward * COMMISSION_RATES.A);
    if (commA > 0) {
      await walletService.credit(
        userA._id,
        TransactionType.TEAM_COMMISSION,
        commA,
        `Team A commission (5%) from ${member.fullName} - ${taskTitle}`,
        { idempotencyKey: `team_comm:A:${completionId}`, meta: { downlineUserId: member._id.toString(), tier: 'A', completionId } }
      );
      await Notification.create({
        userId: userA._id,
        type: NotificationType.REFERRAL,
        title: 'Team commission received',
        message: `You received ₦${commA.toLocaleString()} (A-Level 5%) commission from ${member.fullName}'s task.`,
      }).catch(() => {});
    }
    if (!userA.referredBy) return;

    // Tier B (2%)
    const userB = await User.findById(userA.referredBy).select('_id referredBy fullName');
    if (!userB) return;
    const commB = Math.floor(taskReward * COMMISSION_RATES.B);
    if (commB > 0) {
      await walletService.credit(
        userB._id,
        TransactionType.TEAM_COMMISSION,
        commB,
        `Team B commission (2%) from ${member.fullName} - ${taskTitle}`,
        { idempotencyKey: `team_comm:B:${completionId}`, meta: { downlineUserId: member._id.toString(), tier: 'B', completionId } }
      );
      await Notification.create({
        userId: userB._id,
        type: NotificationType.REFERRAL,
        title: 'Team commission received',
        message: `You received ₦${commB.toLocaleString()} (B-Level 2%) commission from ${member.fullName}'s task.`,
      }).catch(() => {});
    }
    if (!userB.referredBy) return;

    // Tier C (1%)
    const userC = await User.findById(userB.referredBy).select('_id fullName');
    if (!userC) return;
    const commC = Math.floor(taskReward * COMMISSION_RATES.C);
    if (commC > 0) {
      await walletService.credit(
        userC._id,
        TransactionType.TEAM_COMMISSION,
        commC,
        `Team C commission (1%) from ${member.fullName} - ${taskTitle}`,
        { idempotencyKey: `team_comm:C:${completionId}`, meta: { downlineUserId: member._id.toString(), tier: 'C', completionId } }
      );
      await Notification.create({
        userId: userC._id,
        type: NotificationType.REFERRAL,
        title: 'Team commission received',
        message: `You received ₦${commC.toLocaleString()} (C-Level 1%) commission from ${member.fullName}'s task.`,
      }).catch(() => {});
    }
  },

  async getTeamSummary(userId: string | Types.ObjectId) {
    const user = await User.findById(userId).select('referralCode');
    if (!user) return null;

    const downlinesA = await User.find({ referredBy: user._id })
      .select('fullName email status vipLevel createdAt')
      .sort({ createdAt: -1 });
    const aIds = downlinesA.map((d) => d._id);

    const downlinesB = aIds.length > 0
      ? await User.find({ referredBy: { $in: aIds } }).select('fullName email status vipLevel createdAt')
      : [];
    const bIds = downlinesB.map((d) => d._id);

    const downlinesC = bIds.length > 0
      ? await User.find({ referredBy: { $in: bIds } }).select('fullName email status vipLevel createdAt')
      : [];

    const totalTeamEarnings = await walletService.sumByType(userId, TransactionType.TEAM_COMMISSION);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const todayAgg = await Transaction.aggregate<{ total: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId.toString()),
          type: TransactionType.TEAM_COMMISSION,
          createdAt: { $gte: startOfToday },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const todayTeamEarnings = todayAgg[0]?.total ?? 0;

    const levels = await LevelConfig.find({}).select('rank code name');
    const rankToName = new Map(levels.map((l) => [l.rank, l.name]));

    const formatMember = (m: any, levelTier: 'A' | 'B' | 'C') => ({
      id: m._id.toString(),
      name: m.fullName,
      email: m.email,
      teamLevel: levelTier,
      currentPosition: rankToName.get(m.vipLevel ?? 0) || (m.vipLevel === 0 ? 'Intern' : `R${m.vipLevel}`),
      joinedAt: m.createdAt.toISOString(),
    });

    const friends = [
      ...downlinesA.map((m) => formatMember(m, 'A')),
      ...downlinesB.map((m) => formatMember(m, 'B')),
      ...downlinesC.map((m) => formatMember(m, 'C')),
    ];

    const siteUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

    return {
      referralCode: user.referralCode,
      invitationCode: user.referralCode,
      invitationLink: `${siteUrl}/register?ref=${user.referralCode}`,
      totalTeamEarnings,
      todayTeamEarnings,
      totalTeamMembers: downlinesA.length + downlinesB.length + downlinesC.length,
      aLevelMembers: downlinesA.length,
      bLevelMembers: downlinesB.length,
      cLevelMembers: downlinesC.length,
      friends,
    };
  },
};
