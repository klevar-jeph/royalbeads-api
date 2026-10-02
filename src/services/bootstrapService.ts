// src/services/bootstrapService.ts
// Idempotent database seeder for Levels, Salary Positions, System Settings, and Lucky Draw Prizes.

import { LevelConfig, LevelStatus } from '../models/LevelConfig';
import { SalaryPosition } from '../models/SalaryPosition';
import { SystemSetting } from '../models/SystemSetting';
import { LuckyDrawPrize } from '../models/LuckyDrawPrize';

export const INITIAL_LEVELS = [
  { rank: 0, code: 'INTERN', name: 'Intern', status: LevelStatus.OPEN, tasksPerDay: 4, rewardPerTask: 125, dailyEarning: 500, investment: 0, description: 'Entry membership with a zero-deposit start.' },
  { rank: 1, code: 'R1', name: 'R1', status: LevelStatus.OPEN, tasksPerDay: 4, rewardPerTask: 125, dailyEarning: 500, investment: 15_000, description: 'First paid membership level.' },
  { rank: 2, code: 'R2', name: 'R2', status: LevelStatus.OPEN, tasksPerDay: 8, rewardPerTask: 125, dailyEarning: 1_000, investment: 30_000, description: 'Expanded daily task allocation.' },
  { rank: 3, code: 'R3', name: 'R3', status: LevelStatus.OPEN, tasksPerDay: 16, rewardPerTask: 225, dailyEarning: 3_600, investment: 108_000, description: 'Growing membership with increased task rewards.' },
  { rank: 4, code: 'R4', name: 'R4', status: LevelStatus.LOCKED, tasksPerDay: 30, rewardPerTask: 250, dailyEarning: 9_700, investment: 250_000, description: 'Advanced membership tier.' },
  { rank: 5, code: 'R5', name: 'R5', status: LevelStatus.LOCKED, tasksPerDay: 50, rewardPerTask: 300, dailyEarning: 19_400, investment: 500_000, description: 'Higher-volume daily activity tier.' },
  { rank: 6, code: 'R6', name: 'R6', status: LevelStatus.LOCKED, tasksPerDay: 75, rewardPerTask: 400, dailyEarning: 38_800, investment: 1_000_000, description: 'Premium membership tier.' },
  { rank: 7, code: 'R7', name: 'R7', status: LevelStatus.LOCKED, tasksPerDay: 150, rewardPerTask: 500, dailyEarning: 97_500, investment: 2_500_000, description: 'Elite membership tier.' },
  { rank: 8, code: 'R8', name: 'R8', status: LevelStatus.LOCKED, tasksPerDay: 200, rewardPerTask: 750, dailyEarning: 195_000, investment: 5_000_000, description: 'Advanced elite membership tier.' },
  { rank: 9, code: 'R9', name: 'R9', status: LevelStatus.LOCKED, tasksPerDay: 250, rewardPerTask: 1_200, dailyEarning: 390_000, investment: 10_000_000, description: 'Top standard membership tier.' },
  { rank: 10, code: 'MASTER', name: 'Master', status: LevelStatus.LOCKED, tasksPerDay: 300, rewardPerTask: 1_900, dailyEarning: 760_000, investment: 19_000_000, description: 'The highest available membership tier.' },
];

export const INITIAL_SALARY_POSITIONS = [
  { rank: 1, code: 'JUNIOR_ASSISTANT', title: 'Junior Assistant', totalMembersReq: 10, directReferralsReq: 10, aboveLevel1Req: 5, monthlySalary: 40_000, retentionDirectReq: 1, retentionTeamReq: 0, gracePeriodDays: 7 },
  { rank: 2, code: 'INTERMEDIATE_ASSISTANT', title: 'Intermediate Assistant', totalMembersReq: 20, directReferralsReq: 20, aboveLevel1Req: 10, monthlySalary: 100_000, retentionDirectReq: 1, retentionTeamReq: 0, gracePeriodDays: 7 },
  { rank: 3, code: 'JUNIOR_SUPERVISOR', title: 'Junior Supervisor', totalMembersReq: 150, directReferralsReq: 30, aboveLevel1Req: 75, monthlySalary: 300_000, retentionDirectReq: 2, retentionTeamReq: 10, gracePeriodDays: 7 },
  { rank: 4, code: 'INTERMEDIATE_SUPERVISOR', title: 'Intermediate Supervisor', totalMembersReq: 500, directReferralsReq: 50, aboveLevel1Req: 250, monthlySalary: 1_000_000, retentionDirectReq: 3, retentionTeamReq: 25, gracePeriodDays: 7 },
  { rank: 5, code: 'MID_LEVEL_SUPERVISOR', title: 'Mid-Level Supervisor', totalMembersReq: 1_000, directReferralsReq: 100, aboveLevel1Req: 500, monthlySalary: 2_000_000, retentionDirectReq: 5, retentionTeamReq: 50, gracePeriodDays: 7 },
  { rank: 6, code: 'SENIOR_SUPERVISOR', title: 'Senior Supervisor', totalMembersReq: 2_000, directReferralsReq: 300, aboveLevel1Req: 1_000, monthlySalary: 5_000_000, retentionDirectReq: 10, retentionTeamReq: 100, gracePeriodDays: 7 },
  { rank: 7, code: 'CITY_PARTNER', title: 'City Partner', totalMembersReq: 6_000, directReferralsReq: 500, aboveLevel1Req: 3_000, monthlySalary: 16_000_000, retentionDirectReq: 15, retentionTeamReq: 250, gracePeriodDays: 7 },
];

export const INITIAL_LUCKY_DRAW_PRIZES = [
  { label: '₦1,000', amount: 1_000, weight: 50, sortOrder: 1, color: '#F59E0B' },
  { label: '₦5,000', amount: 5_000, weight: 30, sortOrder: 2, color: '#10B981' },
  { label: '₦20,000', amount: 20_000, weight: 12, sortOrder: 3, color: '#3B82F6' },
  { label: '₦50,000', amount: 50_000, weight: 5, sortOrder: 4, color: '#8B5CF6' },
  { label: '₦100,000', amount: 100_000, weight: 2, sortOrder: 5, color: '#EC4899' },
  { label: '₦200,000', amount: 200_000, weight: 1, sortOrder: 6, color: '#EF4444' },
];

export const bootstrapService = {
  async bootstrapAll(): Promise<void> {
    await Promise.all([
      bootstrapService.bootstrapLevels(),
      bootstrapService.bootstrapPositions(),
      bootstrapService.bootstrapSettings(),
      bootstrapService.bootstrapLuckyDrawPrizes(),
    ]);
  },

  async bootstrapLevels(): Promise<void> {
    for (const lvl of INITIAL_LEVELS) {
      const existing = await LevelConfig.findOne({ code: lvl.code });
      if (!existing) {
        await LevelConfig.create(lvl);
        continue;
      }

      // Launch defaults (Intern–R3 OPEN, R4..Master LOCKED) apply only until an
      // admin touches a level: never overwrite a manual open/close decision
      // made from the dashboard. A document whose timestamps are identical has
      // never been edited, so it still carries whatever it was first seeded
      // with — normalise it once so databases seeded by older builds also
      // start with the launch state.
      const neverEdited = existing.createdAt.getTime() === existing.updatedAt.getTime();
      if (neverEdited && existing.status !== lvl.status) {
        await LevelConfig.updateOne(
          { _id: existing._id },
          { $set: { status: lvl.status } }
        ).exec();
      }
    }
  },

  async bootstrapPositions(): Promise<void> {
    for (const pos of INITIAL_SALARY_POSITIONS) {
      const exists = await SalaryPosition.findOne({ code: pos.code });
      if (!exists) {
        await SalaryPosition.create(pos);
      }
    }
  },

  async bootstrapSettings(): Promise<void> {
    const exists = await SystemSetting.findOne({ key: 'GLOBAL' });
    if (!exists) {
      await SystemSetting.create({ key: 'GLOBAL' });
    }
  },

  async bootstrapLuckyDrawPrizes(): Promise<void> {
    const count = await LuckyDrawPrize.countDocuments();
    if (count === 0) {
      await LuckyDrawPrize.insertMany(INITIAL_LUCKY_DRAW_PRIZES);
    }
  },
};
