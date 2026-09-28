// src/services/salaryService.ts
// Salary calculation, qualification, application, accumulation, monthly finalization, and claims.

import { User } from '../models/User';
import { SalaryPosition, ISalaryPosition } from '../models/SalaryPosition';
import { JobApplication, ApplicationStatus, IJobApplication } from '../models/JobApplication';
import { UserPosition, PositionStatus, IUserPosition } from '../models/UserPosition';
import { SalaryLedger, SalaryStatus } from '../models/SalaryLedger';
import { PositionRetentionPeriod } from '../models/PositionRetentionPeriod';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { Notification, NotificationType } from '../models/Notification';
import { bootstrapService } from './bootstrapService';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export function getDaysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

export function getMonthString(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export const salaryService = {
  async calculateUserMetrics(userId: string | Types.ObjectId) {
    const user = await User.findById(userId);
    if (!user) throw httpError(404, 'User not found.');

    const downlinesA = await User.find({ referredBy: user._id }).select('_id vipLevel status');
    const aIds = downlinesA.map((d) => d._id);

    const downlinesB = aIds.length > 0
      ? await User.find({ referredBy: { $in: aIds } }).select('_id vipLevel status')
      : [];
    const bIds = downlinesB.map((d) => d._id);

    const downlinesC = bIds.length > 0
      ? await User.find({ referredBy: { $in: bIds } }).select('_id vipLevel status')
      : [];

    const allMembers = [...downlinesA, ...downlinesB, ...downlinesC];
    const totalMembers = allMembers.length;
    const directReferrals = downlinesA.length;
    // R2+ (vipLevel >= 2) counts as above Level 1 (R1 is normalized to level 1, doesn't count)
    const aboveLevel1 = allMembers.filter((m) => (m.vipLevel ?? 0) >= 2).length;

    return { totalMembers, directReferrals, aboveLevel1 };
  },

  async listPositionsWithProgress(userId: string | Types.ObjectId) {
    await bootstrapService.bootstrapPositions();
    const positions = await SalaryPosition.find({ active: true }).sort({ rank: 1 });
    const metrics = await salaryService.calculateUserMetrics(userId);

    const activeUserPosition = await UserPosition.findOne({
      userId,
      status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] },
    });

    const pendingApps = await JobApplication.find({
      userId,
      status: { $in: [ApplicationStatus.UNDER_REVIEW, ApplicationStatus.PENDING_REQUIREMENTS] },
    });
    const appByPosId = new Map(pendingApps.map((a) => [a.positionId.toString(), a]));

    const result = positions.map((p: ISalaryPosition) => {
      const isQualified =
        metrics.totalMembers >= p.totalMembersReq &&
        metrics.directReferrals >= p.directReferralsReq &&
        metrics.aboveLevel1 >= p.aboveLevel1Req;

      const app = appByPosId.get(p._id.toString());
      const isCurrentPosition = activeUserPosition?.positionCode === p.code;

      let status = 'NOT_QUALIFIED';
      if (isCurrentPosition) status = 'CURRENT_POSITION';
      else if (app) status = app.status;
      else if (isQualified) status = 'ELIGIBLE_TO_APPLY';

      return {
        id: p._id.toString(),
        rank: p.rank,
        code: p.code,
        title: p.title,
        monthlySalary: p.monthlySalary,
        totalMembersReq: p.totalMembersReq,
        directReferralsReq: p.directReferralsReq,
        aboveLevel1Req: p.aboveLevel1Req,
        retentionDirectReq: p.retentionDirectReq,
        retentionTeamReq: p.retentionTeamReq,
        userProgress: metrics,
        remaining: {
          totalMembers: Math.max(p.totalMembersReq - metrics.totalMembers, 0),
          directReferrals: Math.max(p.directReferralsReq - metrics.directReferrals, 0),
          aboveLevel1: Math.max(p.aboveLevel1Req - metrics.aboveLevel1, 0),
        },
        isQualified,
        status,
      };
    });

    return { positions: result, currentPosition: activeUserPosition };
  },

  async applyForPosition(userId: string | Types.ObjectId, positionId: string) {
    const position = await SalaryPosition.findById(positionId);
    if (!position || !position.active) throw httpError(404, 'Position not found.');

    const metrics = await salaryService.calculateUserMetrics(userId);
    const isQualified =
      metrics.totalMembers >= position.totalMembersReq &&
      metrics.directReferrals >= position.directReferralsReq &&
      metrics.aboveLevel1 >= position.aboveLevel1Req;

    if (!isQualified) {
      throw httpError(422, 'You do not meet the minimum requirements for this position.');
    }

    const existing = await JobApplication.findOne({
      userId,
      positionId: position._id,
      status: ApplicationStatus.UNDER_REVIEW,
    });
    if (existing) {
      throw httpError(409, 'You already have a pending application for this position.');
    }

    const application = await JobApplication.create({
      userId,
      positionId: position._id,
      positionCode: position.code,
      positionTitle: position.title,
      status: ApplicationStatus.UNDER_REVIEW,
      snapshotTotalMembers: metrics.totalMembers,
      snapshotDirectReferrals: metrics.directReferrals,
      snapshotAboveLevel1: metrics.aboveLevel1,
    });

    await Notification.create({
      userId,
      type: NotificationType.SYSTEM,
      title: 'Job application submitted',
      message: `Your application for ${position.title} has been received and is under review.`,
    }).catch(() => {});

    return application;
  },

  async reviewApplication(
    applicationId: string,
    reviewerId: string | Types.ObjectId,
    decision: 'APPROVE' | 'REJECT',
    remarks?: string
  ): Promise<IJobApplication> {
    const app = await JobApplication.findById(applicationId);
    if (!app) throw httpError(404, 'Application not found.');
    if (app.status !== ApplicationStatus.UNDER_REVIEW) {
      throw httpError(409, 'Application has already been reviewed.');
    }

    app.reviewedBy = new Types.ObjectId(reviewerId.toString());
    app.reviewedAt = new Date();
    app.reviewRemarks = remarks;

    if (decision === 'REJECT') {
      app.status = ApplicationStatus.REJECTED;
      await app.save();

      await Notification.create({
        userId: app.userId,
        type: NotificationType.SYSTEM,
        title: 'Job application not approved',
        message: remarks
          ? `Your application for ${app.positionTitle} was not approved: ${remarks}`
          : `Your application for ${app.positionTitle} was not approved.`,
      }).catch(() => {});

      return app;
    }

    app.status = ApplicationStatus.APPROVED;
    await app.save();

    const position = await SalaryPosition.findById(app.positionId);
    if (!position) throw httpError(404, 'Salary position configuration missing.');

    await UserPosition.updateMany(
      {
        userId: app.userId,
        status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] },
      },
      { $set: { status: PositionStatus.DISQUALIFIED, disqualificationReason: 'Promoted to new position' } }
    );

    const now = new Date();
    const userPos = await UserPosition.create({
      userId: app.userId,
      positionId: position._id,
      positionCode: position.code,
      positionTitle: position.title,
      status: PositionStatus.ACTIVE,
      effectiveDate: now,
      monthlySalary: position.monthlySalary,
      qualifyingTotalMembers: app.snapshotTotalMembers,
      qualifyingDirectReferrals: app.snapshotDirectReferrals,
      qualifyingAboveLevel1: app.snapshotAboveLevel1,
    });

    await salaryService.initializeMonthAccumulation(userPos, now);

    await Notification.create({
      userId: app.userId,
      type: NotificationType.SYSTEM,
      title: 'Position approved & activated!',
      message: `Congratulations! Your position as ${position.title} is now active with monthly salary of ₦${position.monthlySalary.toLocaleString()}.`,
    }).catch(() => {});

    return app;
  },

  async initializeMonthAccumulation(userPosition: IUserPosition, date = new Date()) {
    const monthStr = getMonthString(date);
    const year = date.getUTCFullYear();
    const monthIdx = date.getUTCMonth();
    const daysInMonth = getDaysInMonth(year, monthIdx);

    const effDate = new Date(userPosition.effectiveDate);
    const isEffectiveThisMonth =
      effDate.getUTCFullYear() === year && effDate.getUTCMonth() === monthIdx;

    const qualifyingStartDay = isEffectiveThisMonth ? effDate.getUTCDate() : 1;
    const qualifyingDays = Math.max(daysInMonth - qualifyingStartDay + 1, 0);

    const dailyRate = Math.floor(userPosition.monthlySalary / daysInMonth);
    const accumulatedAmount = dailyRate * qualifyingDays;

    let ledger = await SalaryLedger.findOne({ userId: userPosition.userId, salaryMonth: monthStr });
    if (!ledger) {
      ledger = await SalaryLedger.create({
        userId: userPosition.userId,
        positionId: userPosition.positionId,
        positionCode: userPosition.positionCode,
        positionTitle: userPosition.positionTitle,
        salaryMonth: monthStr,
        qualificationDate: userPosition.effectiveDate,
        monthlySalary: userPosition.monthlySalary,
        daysInMonth,
        qualifyingDays,
        dailyRate,
        accumulatedAmount,
        finalAmount: accumulatedAmount,
        status: SalaryStatus.ACCUMULATING,
      });
    } else if (ledger.status === SalaryStatus.ACCUMULATING) {
      ledger.positionId = userPosition.positionId;
      ledger.positionCode = userPosition.positionCode;
      ledger.positionTitle = userPosition.positionTitle;
      ledger.monthlySalary = userPosition.monthlySalary;
      ledger.dailyRate = dailyRate;
      ledger.qualifyingDays = qualifyingDays;
      ledger.accumulatedAmount = accumulatedAmount;
      ledger.finalAmount = accumulatedAmount;
      await ledger.save();
    }
    return ledger;
  },

  async finalizeMonthEnd(targetMonth = getMonthString()): Promise<{ finalizedCount: number }> {
    const records = await SalaryLedger.find({
      salaryMonth: targetMonth,
      status: SalaryStatus.ACCUMULATING,
    });

    let finalizedCount = 0;
    for (const record of records) {
      record.status = SalaryStatus.READY_TO_CLAIM;
      record.finalAmount = record.accumulatedAmount;
      await record.save();
      finalizedCount += 1;

      await Notification.create({
        userId: record.userId,
        type: NotificationType.WALLET,
        title: 'Salary ready to claim!',
        message: `Your ${record.salaryMonth} salary of ₦${record.finalAmount.toLocaleString()} (${record.positionTitle}) is now ready to claim in My Position.`,
      }).catch(() => {});
    }

    const activePositions = await UserPosition.find({
      status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] },
    });

    const nextDate = new Date();
    for (const pos of activePositions) {
      await salaryService.initializeMonthAccumulation(pos, nextDate);
    }

    return { finalizedCount };
  },

  async claimSalary(userId: string | Types.ObjectId, ledgerId: string) {
    const ledger = await SalaryLedger.findOne({ _id: ledgerId, userId });
    if (!ledger) throw httpError(404, 'Salary record not found.');

    if (ledger.status !== SalaryStatus.READY_TO_CLAIM) {
      if (ledger.status === SalaryStatus.CLAIMED) {
        throw httpError(409, 'This salary has already been claimed.');
      }
      throw httpError(400, 'Salary is not yet ready to claim.');
    }

    if (ledger.finalAmount <= 0) {
      throw httpError(400, 'Claim amount must be greater than zero.');
    }

    const claimReference = `SAL-${ledger.salaryMonth}-${ledger.userId.toString().slice(-6)}-${Date.now().toString(36).toUpperCase()}`;

    const claimedLedger = await SalaryLedger.findOneAndUpdate(
      { _id: ledger._id, status: SalaryStatus.READY_TO_CLAIM },
      {
        $set: {
          status: SalaryStatus.CLAIMED,
          claimDate: new Date(),
          claimReference,
        },
      },
      { new: true }
    );

    if (!claimedLedger) {
      throw httpError(409, 'Salary claim conflict or already claimed.');
    }

    try {
      await walletService.credit(
        userId,
        TransactionType.SALARY_CLAIM,
        claimedLedger.finalAmount,
        `Salary Claim: ${claimedLedger.positionTitle} (${claimedLedger.salaryMonth})`,
        {
          idempotencyKey: claimReference,
          meta: {
            salaryLedgerId: claimedLedger._id.toString(),
            positionCode: claimedLedger.positionCode,
            salaryMonth: claimedLedger.salaryMonth,
          },
        }
      );
    } catch (err) {
      await SalaryLedger.updateOne(
        { _id: ledger._id },
        { $set: { status: SalaryStatus.READY_TO_CLAIM }, $unset: { claimDate: 1, claimReference: 1 } }
      );
      throw err;
    }

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Salary claimed successfully',
      message: `₦${claimedLedger.finalAmount.toLocaleString()} has been credited to your Main Balance (Ref: ${claimReference}).`,
    }).catch(() => {});

    return claimedLedger;
  },

  async getUserSalaryLedger(userId: string | Types.ObjectId) {
    return SalaryLedger.find({ userId }).sort({ salaryMonth: -1 });
  },

  async evaluateWeeklyRetention(): Promise<{ evaluated: number }> {
    const activePositions = await UserPosition.find({
      status: { $in: [PositionStatus.ACTIVE, PositionStatus.REQUIREMENT_IN_PROGRESS, PositionStatus.AT_RISK] },
    }).populate<{ positionId: ISalaryPosition }>('positionId');

    // Weekly retention window: the current ISO week (Mon 00:00 UTC → now).
    // New users referred since Monday count toward this week's target.
    const now = new Date();
    const weekStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const mondayOffset = (weekStart.getUTCDay() + 6) % 7; // days since Monday
    weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);

    let evaluated = 0;
    for (const pos of activePositions) {
      const positionConf = pos.positionId;
      if (!positionConf) continue;

      const requiredDirect = positionConf.retentionDirectReq ?? 1;

      // Recent referrals counted against the CURRENT week (Mon 00:00 → now).
      const recentDirects = await User.countDocuments({
        referredBy: pos.userId,
        createdAt: { $gte: weekStart },
      });
      const metDirect = recentDirects >= requiredDirect;

      // Escalation ladder for consecutive missed weeks. When the position
      // already carries a requirement-in-progress/at-risk marker, a further
      // miss escalates one step so repeated scheduler runs walk
      // ACTIVE → IN_PROGRESS → AT_RISK → DISQUALIFIED exactly as the
      // specification's weekly cadence intends.
      let newStatus = pos.status;
      let reason = '';

      if (metDirect) {
        newStatus = PositionStatus.ACTIVE;
      } else if (pos.status === PositionStatus.ACTIVE) {
        newStatus = PositionStatus.REQUIREMENT_IN_PROGRESS;
        reason = `Direct referral target for week not yet met (${recentDirects}/${requiredDirect})`;
      } else {
        // Already flagged in a previous evaluation → escalate one step.
        newStatus =
          pos.status === PositionStatus.REQUIREMENT_IN_PROGRESS
            ? PositionStatus.AT_RISK
            : PositionStatus.DISQUALIFIED;
        if (newStatus === PositionStatus.AT_RISK) {
          reason = `Position at risk: failed weekly retention target (${recentDirects}/${requiredDirect})`;
        } else {
          pos.disqualifiedAt = now;
          pos.disqualificationReason = `Failed weekly retention requirement after grace period (${recentDirects}/${requiredDirect})`;
          pos.failedRequirement = `Direct Referrals: required ${requiredDirect}, got ${recentDirects}`;
        }
      }

      pos.status = newStatus;
      await pos.save();

      // One evaluation row per position — repeated in-week runs refresh the
      // row instead of duplicating it (idempotent weekly records).
      await PositionRetentionPeriod.findOneAndUpdate(
        { userPositionId: pos._id, weekStart, weekEnd: { $gte: now } },
        {
          $set: {
            userPositionId: pos._id,
            userId: pos.userId,
            positionCode: pos.positionCode,
            weekStart,
            weekEnd: now,
            requiredDirectReferrals: requiredDirect,
            actualDirectReferrals: recentDirects,
            requiredTeamActivity: positionConf.retentionTeamReq ?? 0,
            actualTeamActivity: 0,
            status: newStatus,
            evaluatedAt: new Date(),
            reason,
          },
        },
        { upsert: true }
      ).catch(() => {});

      if (newStatus === PositionStatus.AT_RISK) {
        await Notification.create({
          userId: pos.userId,
          type: NotificationType.SYSTEM,
          title: 'Position at risk!',
          message: `Your position as ${pos.positionTitle} is at risk due to unmet weekly retention requirements.`,
        }).catch(() => {});
      } else if (newStatus === PositionStatus.DISQUALIFIED) {
        await Notification.create({
          userId: pos.userId,
          type: NotificationType.SYSTEM,
          title: 'Position disqualified',
          message: `Your position as ${pos.positionTitle} has been disqualified due to expired retention grace period. Historical salary remains safe.`,
        }).catch(() => {});
      }

      evaluated += 1;
    }

    return { evaluated };
  },
};

