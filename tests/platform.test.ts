// tests/platform.test.ts
// Integration tests for the level/task engine, team commissions, salary
// lifecycle, retention, rewards (Lucky Draw / Red Envelope / Weekly Events),
// Audit Mode and the configurable withdrawal rules.

import request from 'supertest';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { freshApp, TEST_USER } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { Transaction, TransactionType } from '../src/models/Transaction';
import { Task } from '../src/models/Task';
import { TaskCompletion } from '../src/models/TaskCompletion';
import { LevelConfig, LevelStatus } from '../src/models/LevelConfig';
import { TaskScheduleOverride } from '../src/models/TaskScheduleOverride';
import { SalaryPosition } from '../src/models/SalaryPosition';
import { UserPosition, PositionStatus } from '../src/models/UserPosition';
import { SalaryLedger, SalaryStatus } from '../src/models/SalaryLedger';
import { AuditLog } from '../src/models/AuditLog';
import { bootstrapService } from '../src/services/bootstrapService';
import { levelService } from '../src/services/levelService';
import { taskScheduleService } from '../src/services/taskScheduleService';
import { taskService } from '../src/services/taskService';
import { salaryService } from '../src/services/salaryService';
import { systemSettingService } from '../src/services/systemSettingService';

/** Register a user through the public endpoint (optionally referred). */
async function register(
  app: Express,
  email: string,
  referralCode?: string
): Promise<{ agent: any; userId: string }> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/auth/register')
    .send({
      fullName: email.split('@')[0],
      email,
      password: TEST_USER.password,
      ...(referralCode ? { referralCode } : {}),
    })
    .expect(201);
  return { agent, userId: res.body.user.id };
}

async function adminAgent(app: Express) {
  await User.create({
    fullName: 'Ops Admin',
    email: 'ops-platform@royalbeads.test',
    passwordHash: TEST_USER.password,
    role: UserRole.ADMIN,
    status: AccountStatus.ACTIVE,
  });
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: 'ops-platform@royalbeads.test', password: TEST_USER.password })
    .expect(200);
  return agent;
}

async function fund(userId: string, amount: number): Promise<void> {
  const { walletService } = await import('../src/services/walletService');
  await walletService.credit(userId, TransactionType.ADJUSTMENT, amount, 'test funding', {
    idempotencyKey: `fund-${userId}-${amount}-${Date.now()}`,
  });
}

describe('Level system', () => {
  it('seeds the Intern → Master hierarchy with R1–R3 open and R4+ locked', async () => {
    await bootstrapService.bootstrapLevels();
    const levels = await levelService.listLevels();

    expect(levels.map((l) => l.code)).toEqual([
      'INTERN',
      'R1',
      'R2',
      'R3',
      'R4',
      'R5',
      'R6',
      'R7',
      'R8',
      'R9',
      'MASTER',
    ]);
    expect(levels[10].rank).toBe(10); // Master is the highest level.

    const byCode = new Map(levels.map((l) => [l.code, l]));
    expect(byCode.get('R1')!.status).toBe(LevelStatus.OPEN);
    expect(byCode.get('R2')!.status).toBe(LevelStatus.OPEN);
    expect(byCode.get('R3')!.status).toBe(LevelStatus.OPEN);
    for (const code of ['R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'MASTER']) {
      expect(byCode.get(code)!.status).toBe(LevelStatus.LOCKED);
    }
  });

  it('derives daily earning from tasks/day × reward/task when tasks change', async () => {
    await bootstrapService.bootstrapLevels();
    const level = await levelService.updateLevel('R5', { tasksPerDay: 20, rewardPerTask: 100 });
    expect(level.dailyEarning).toBe(2_000);
  });

  it('lets an admin open a locked level and records an audit entry', async () => {
    const app = freshApp();
    const admin = await adminAgent(app);
    await bootstrapService.bootstrapLevels();

    const res = await admin
      .patch('/api/admin/levels/R4')
      .send({ status: 'OPEN', tasksPerDay: 30, rewardPerTask: 250 })
      .expect(200);

    expect(res.body.level.status).toBe('OPEN');
    expect(await AuditLog.countDocuments({ action: 'level.update' })).toBe(1);
  });

  it('blocks non-admins from level management', async () => {
    const app = freshApp();
    const { agent } = await register(app, 'plain@royalbeads.test');
    await agent.patch('/api/admin/levels/R4').send({ status: 'OPEN' }).expect(403);
  });
});

describe('Task schedule engine', () => {
  it('enables Intern on weekends but disables Saturdays for R-levels', async () => {
    await systemSettingService.getSettings();
    // 2026-09-26 is a Saturday.
    const saturday = new Date(Date.UTC(2026, 8, 26, 12, 0, 0));

    const intern = await taskScheduleService.evaluateTaskAvailability('INTERN', saturday);
    expect(intern.enabled).toBe(true);

    const r1 = await taskScheduleService.evaluateTaskAvailability('R1', saturday);
    expect(r1.enabled).toBe(false);
    expect(r1.reason).toMatch(/weekend schedule/i);
  });

  it('never changes Saturday when Sunday is changed', async () => {
    const settings = await systemSettingService.getSettings();
    settings.taskSaturdayEnabled = false;
    settings.taskSundayEnabled = false;
    await settings.save();

    await systemSettingService.updateSettings({ taskSundayEnabled: true } as never);
    const after = await systemSettingService.getSettings();
    expect(after.taskSundayEnabled).toBe(true);
    expect(after.taskSaturdayEnabled).toBe(false);
  });

  it('lets an explicit date override disable tasks (holiday)', async () => {
    await systemSettingService.getSettings();
    const wednesday = new Date(Date.UTC(2026, 8, 23, 12, 0, 0));
    await TaskScheduleOverride.create({
      date: '2026-09-23',
      overrideType: 'HOLIDAY',
      reason: 'Public holiday',
      enabled: false,
    });

    const res = await taskScheduleService.evaluateTaskAvailability('R1', wednesday);
    expect(res.enabled).toBe(false);
    expect(res.reason).toMatch(/holiday|override/i);
  });
});

describe('Intern 3-day allowance', () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 12, 0, 0));
  const dayStr = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  function seedDays(userId: string, days: string[]) {
    return TaskCompletion.create(
      days.map((day, i) => ({
        userId,
        taskKey: `seed-${i}`,
        taskTitle: 'Seeded completion',
        day,
        reward: 100,
      }))
    );
  }

  it('allows Sundays for interns even when Sunday is off for everyone else', async () => {
    const settings = await systemSettingService.getSettings();
    settings.taskInternWeekendEnabled = false;
    settings.taskSundayEnabled = false;
    await settings.save();

    const sunday = utc(2026, 8, 27); // 2026-09-27 is a Sunday.
    const intern = await taskScheduleService.evaluateTaskAvailability('INTERN', sunday);
    expect(intern.enabled).toBe(true);

    const r1 = await taskScheduleService.evaluateTaskAvailability('R1', sunday);
    expect(r1.enabled).toBe(false);
    expect(r1.reason).toMatch(/weekend schedule/i);
  });

  it('blocks a new day after 3 lifetime working days but keeps the current day open', async () => {
    await systemSettingService.getSettings();
    const internId = new Types.ObjectId();
    await seedDays(internId.toString(), ['2026-09-21', '2026-09-22', '2026-09-23']);

    // A fresh day (Thursday) is refused once the allowance is spent.
    const freshDay = await taskScheduleService.evaluateTaskAvailability(
      'INTERN',
      utc(2026, 8, 24),
      internId
    );
    expect(freshDay.enabled).toBe(false);
    expect(freshDay.status).toBe('DISABLED');
    expect(freshDay.reason).toMatch(/3 Intern working days/);

    // A day already worked stays usable so the intern can finish it out.
    const sameDay = await taskScheduleService.evaluateTaskAvailability(
      'INTERN',
      utc(2026, 8, 22),
      internId
    );
    expect(sameDay.enabled).toBe(true);

    // The allowance is intern-only — an R1 user with identical history is fine.
    const r1 = await taskScheduleService.evaluateTaskAvailability(
      'R1',
      utc(2026, 8, 24),
      internId
    );
    expect(r1.enabled).toBe(true);
  });

  it('refuses task completion with 403 once the allowance is spent', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    await taskService.syncDefinitions();

    const { agent, userId } = await register(app, 'intern-quota@royalbeads.test');
    // Three previously worked days — today is not among them.
    await seedDays(userId, [dayStr(-10), dayStr(-9), dayStr(-8)]);

    const task = await Task.findOne({ active: true });
    const res = await agent.post(`/api/tasks/${task!._id}/complete`).expect(403);
    expect(res.body.message).toMatch(/upgrade/i);
    expect(await TaskCompletion.countDocuments({ userId })).toBe(3);
  });

  it('keeps completing tasks on a day already counted in the allowance', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    await taskService.syncDefinitions();

    const { agent, userId } = await register(app, 'intern-sameday@royalbeads.test');
    // Three days including today: the quota is spent, but today stays open.
    await seedDays(userId, [dayStr(-10), dayStr(-9), dayStr(0)]);

    const task = await Task.findOne({ active: true });
    const res = await agent.post(`/api/tasks/${task!._id}/complete`).expect(201);
    expect(res.body.reward).toBeGreaterThan(0);
    expect(await TaskCompletion.countDocuments({ userId })).toBe(4);
  });
});

describe('Task completion & team commissions', () => {
  it('credits 5%/2%/1% to A/B/C uplines and retries without duplicates', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    await taskService.syncDefinitions();

    const { userId: uplineC } = await register(app, 'c-chain@royalbeads.test');
    const codeC = (await User.findById(uplineC).select('referralCode'))!.referralCode;
    const { userId: uplineB } = await register(app, 'b-chain@royalbeads.test', codeC);
    const codeB = (await User.findById(uplineB).select('referralCode'))!.referralCode;
    const { userId: uplineA } = await register(app, 'a-chain@royalbeads.test', codeB);
    const codeA = (await User.findById(uplineA).select('referralCode'))!.referralCode;
    const { agent, userId: member } = await register(app, 'member@royalbeads.test', codeA);

    // Deterministic task: exactly one Intern task with a whole-number reward
    // divisible by 100 so the 5%/2%/1% split is exact.
    await Task.updateMany({}, { $set: { active: false } });
    const big = await Task.create({
      key: 'big-task',
      title: 'Big task',
      description: 'fixed reward',
      reward: 1_000,
      minVipTier: 0,
      assignedLevels: [],
      dailyLimit: 1,
      active: true,
      sortOrder: 0,
    });

    const first = await agent.post(`/api/tasks/${big._id}/complete`).expect(201);
    expect(first.body.reward).toBe(1_000);

    // Repeating the same task is blocked (per-task daily limit).
    await agent.post(`/api/tasks/${big._id}/complete`).expect(409);

    const { Types } = await import('mongoose');
    const balance = async (id: string) =>
      (
        await Transaction.aggregate<{ total: number }>([
          {
            $match: {
              userId: new Types.ObjectId(id),
              type: TransactionType.TEAM_COMMISSION,
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
      )[0]?.total ?? 0;

    expect(await balance(uplineA)).toBe(50); // 5% of 1,000
    expect(await balance(uplineB)).toBe(20); // 2% of 1,000
    expect(await balance(uplineC)).toBe(10); // 1% of 1,000

    // A retry (same completion) cannot create a second commission.
    const { teamCommissionService } = await import('../src/services/teamCommissionService');
    const completions = await TaskCompletion.find({ userId: member });
    await teamCommissionService.distributeTaskCommissions(
      member,
      1_000,
      completions[0]._id.toString(),
      'Big task'
    );
    expect(await balance(uplineA)).toBe(50);

    // Personal reward credited exactly once.
    const personal = await Transaction.countDocuments({
      userId: member,
      type: TransactionType.TASK_REWARD,
    });
    expect(personal).toBe(1);
  });

  it('exposes the team overview with A/B/C friend positions', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { userId: root } = await register(app, 'root-team@royalbeads.test');
    const code = (await User.findById(root).select('referralCode'))!.referralCode;
    await register(app, 'root-a@royalbeads.test', code);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: 'root-team@royalbeads.test', password: 'Str0ngPass!' })
      .expect(200);

    const res = await agent.get('/api/team').expect(200);
    expect(res.body.team.aLevelMembers).toBe(1);
    expect(res.body.team.totalTeamMembers).toBe(1);
    expect(res.body.team.totalTeamEarnings).toBe(0);
    expect(res.body.team.todayTeamEarnings).toBeNull();
    expect(res.body.team.friends[0].teamLevel).toBe('A');
    expect(res.body.team.invitationCode).toBe(code);
  });
});

describe('Salary qualification, application & activation', () => {
  it('shows real progress and only allows applying when qualified', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { agent, userId } = await register(app, 'salary-seeker@royalbeads.test');
    const own = await User.findById(userId).select('referralCode');
    // 10 direct referrals, all with vipLevel >= 2 (R2+) → qualifies Junior Assistant.
    for (let i = 0; i < 10; i += 1) {
      const { userId: down } = await register(app, `ja-${i}@royalbeads.test`, own!.referralCode);
      await User.updateOne({ _id: down }, { $set: { vipLevel: 2 } });
    }

    const res = await agent.get('/api/salary/positions').expect(200);
    const junior = res.body.positions.find((p: any) => p.code === 'JUNIOR_ASSISTANT');
    expect(junior.userProgress).toMatchObject({
      totalMembers: 10,
      directReferrals: 10,
      aboveLevel1: 10,
    });
    expect(junior.isQualified).toBe(true);
    expect(junior.status).toBe('ELIGIBLE_TO_APPLY');

    const applied = await agent
      .post('/api/salary/apply')
      .send({ positionId: junior.id })
      .expect(201);
    expect(applied.body.application.status).toBe('UNDER_REVIEW');

    // Duplicate pending application is blocked.
    await agent.post('/api/salary/apply').send({ positionId: junior.id }).expect(409);
  });

  it('rejects applications that do not meet requirements', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { agent } = await register(app, 'not-qualified@royalbeads.test');
    const res = await agent.get('/api/salary/positions').expect(200);
    const junior = res.body.positions.find((p: any) => p.code === 'JUNIOR_ASSISTANT');
    expect(junior.isQualified).toBe(false);
    expect(junior.status).toBe('NOT_QUALIFIED');

    await agent.post('/api/salary/apply').send({ positionId: junior.id }).expect(422);
  });

  it('activates the position on admin approval and starts salary accumulation', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { agent, userId } = await register(app, 'salary-activate@royalbeads.test');
    const own = await User.findById(userId).select('referralCode');
    for (let i = 0; i < 10; i += 1) {
      const { userId: down } = await register(app, `sa-${i}@royalbeads.test`, own!.referralCode);
      await User.updateOne({ _id: down }, { $set: { vipLevel: 2 } });
    }

    const positions = (await agent.get('/api/salary/positions').expect(200)).body.positions;
    const junior = positions.find((p: any) => p.code === 'JUNIOR_ASSISTANT');
    const applied = await agent.post('/api/salary/apply').send({ positionId: junior.id }).expect(201);

    const admin = await adminAgent(app);
    await admin
      .post(`/api/admin/salary/applications/${applied.body.application._id}/review`)
      .send({ decision: 'APPROVE', remarks: 'verified network' })
      .expect(200);

    expect(await AuditLog.countDocuments({ action: 'salary.application.review' })).toBe(1);

    const mine = await agent.get('/api/salary/position').expect(200);
    expect(mine.body.currentPosition.positionCode).toBe('JUNIOR_ASSISTANT');
    expect(mine.body.currentPosition.status).toBe('ACTIVE');
    expect(mine.body.salaryLedger.length).toBeGreaterThan(0);

    const acc = mine.body.salaryLedger.find((l: any) => l.status === 'ACCUMULATING');
    expect(acc).toBeTruthy();
    // ₦40,000 / actual days in month, no fixed 30-day assumption.
    const expectedDays = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 0)
    ).getUTCDate();
    expect(acc.daysInMonth).toBe(expectedDays);
    expect(acc.dailyRate).toBe(Math.floor(40_000 / expectedDays));
  });
});

describe('Salary finalization & claims', () => {
  it('finalizes once per month and credits the wallet exactly once on claim', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { agent, userId } = await register(app, 'salary-claim@royalbeads.test');
    const own = await User.findById(userId).select('referralCode');
    for (let i = 0; i < 10; i += 1) {
      const { userId: down } = await register(app, `sc-${i}@royalbeads.test`, own!.referralCode);
      await User.updateOne({ _id: down }, { $set: { vipLevel: 2 } });
    }

    const positions = (await agent.get('/api/salary/positions').expect(200)).body.positions;
    const junior = positions.find((p: any) => p.code === 'JUNIOR_ASSISTANT');
    const applied = await agent.post('/api/salary/apply').send({ positionId: junior.id }).expect(201);

    const admin = await adminAgent(app);
    await admin
      .post(`/api/admin/salary/applications/${applied.body.application._id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const month = (await agent.get('/api/salary/position').expect(200)).body.salaryLedger[0]
      .salaryMonth;

    // Running finalization twice must not create two salaries.
    const once = await admin
      .post('/api/admin/salary/jobs/finalize-month')
      .send({ month })
      .expect(200);
    const twice = await admin
      .post('/api/admin/salary/jobs/finalize-month')
      .send({ month })
      .expect(200);
    expect(once.body.finalizedCount).toBe(1);
    expect(twice.body.finalizedCount).toBe(0);
    expect(await SalaryLedger.countDocuments({ userId, salaryMonth: month })).toBe(1);

    const ready = await SalaryLedger.findOne({ userId });
    expect(ready!.status).toBe(SalaryStatus.READY_TO_CLAIM);

    const claimed = await agent.post(`/api/salary/${ready!._id}/claim`).expect(200);
    // Claim moves the exact final amount to the Main Balance once.
    const tx = await Transaction.findOne({ userId, type: TransactionType.SALARY_CLAIM });
    expect(tx).toBeTruthy();
    expect(tx!.amount).toBe(claimed.body.salary.finalAmount);

    // A second click fails safely — no duplicate.
    await agent.post(`/api/salary/${ready!._id}/claim`).expect(409);
    expect(
      await Transaction.countDocuments({ userId, type: TransactionType.SALARY_CLAIM })
    ).toBe(1);
  });
});

describe('Position retention & disqualification', () => {
  it('walks ACTIVE → IN_PROGRESS → AT_RISK → DISQUALIFIED across weeks', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { userId } = await register(app, 'retention-walk@royalbeads.test');
    const own = await User.findById(userId).select('referralCode');
    for (let i = 0; i < 10; i += 1) {
      const { userId: down } = await register(app, `rw-${i}@royalbeads.test`, own!.referralCode);
      await User.updateOne({ _id: down }, { $set: { vipLevel: 2 } });
    }
    // All referrals are genuinely old → every weekly retention evaluation in
    // this test misses the "1 new direct referral" target: status walks
    // ACTIVE → IN_PROGRESS → AT_RISK → DISQUALIFIED. The update goes through
    // the raw collection because Mongoose's timestamps plugin protects
    // createdAt from being modified by query updates.
    const wednesdayNoon = new Date(Date.UTC(2025, 0, 8, 12, 0, 0)); // Wed, previous year
    await User.collection.updateMany(
      { referredBy: new Types.ObjectId(userId) },
      { $set: { createdAt: wednesdayNoon, updatedAt: wednesdayNoon } }
    );
    expect(
      await User.countDocuments({
        referredBy: userId,
        createdAt: { $gte: new Date(Date.UTC(2026, 0, 1)) },
      })
    ).toBe(0);

    const position = await SalaryPosition.findOne({ code: 'JUNIOR_ASSISTANT' });
    const userPos = await UserPosition.create({
      userId,
      positionId: position!._id,
      positionCode: 'JUNIOR_ASSISTANT',
      positionTitle: 'Junior Assistant',
      status: PositionStatus.ACTIVE,
      effectiveDate: new Date(),
      monthlySalary: 40_000,
      qualifyingTotalMembers: 10,
      qualifyingDirectReferrals: 10,
      qualifyingAboveLevel1: 10,
    });

    // All referrals were backdated outside the window → retention is missed.
    await salaryService.evaluateWeeklyRetention();
    let pos = await UserPosition.findById(userPos._id);
    expect(pos!.status).toBe(PositionStatus.REQUIREMENT_IN_PROGRESS);

    await salaryService.evaluateWeeklyRetention();
    pos = await UserPosition.findById(userPos._id);
    expect(pos!.status).toBe(PositionStatus.AT_RISK);

    await salaryService.evaluateWeeklyRetention();
    pos = await UserPosition.findById(userPos._id);
    expect(pos!.status).toBe(PositionStatus.DISQUALIFIED);

    // Historical salary survives disqualification.
    await salaryService.initializeMonthAccumulation(userPos, new Date());
    const acc = await SalaryLedger.findOne({ userId });
    expect(acc).toBeTruthy();
  });

  it('restores a disqualified position through the audited admin action', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { userId } = await register(app, 'restore-me@royalbeads.test');
    const position = await SalaryPosition.findOne({ code: 'JUNIOR_ASSISTANT' });
    const userPos = await UserPosition.create({
      userId,
      positionId: position!._id,
      positionCode: 'JUNIOR_ASSISTANT',
      positionTitle: 'Junior Assistant',
      status: PositionStatus.DISQUALIFIED,
      effectiveDate: new Date(),
      monthlySalary: 40_000,
      disqualifiedAt: new Date(),
      disqualificationReason: 'test',
    });

    const admin = await adminAgent(app);
    const res = await admin
      .post(`/api/admin/salary/retention/${userPos._id}/restore`)
      .send({ reason: 'customer care exception' })
      .expect(200);
    expect(res.body.position.status).toBe(PositionStatus.ACTIVE);
    expect(await AuditLog.countDocuments({ action: 'salary.position.restore' })).toBe(1);
  });
});

describe('Lucky Draw', () => {
  it('awards exactly one spin per qualifying referral and one reward per spin', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    const { userId: referrer } = await register(app, 'lucky-referrer@royalbeads.test');
    const code = (await User.findById(referrer).select('referralCode'))!.referralCode;
    await register(app, 'lucky-friend@royalbeads.test', code);

    // Retry referral processing — no second spin for the same referral.
    const { luckyDrawService } = await import('../src/services/luckyDrawService');
    const referred = await User.findOne({ email: 'lucky-friend@royalbeads.test' });
    await luckyDrawService.awardSpinForReferral(referrer, referred!._id);
    const { LuckyDrawEntitlement } = await import('../src/models/LuckyDrawEntitlement');
    expect(
      await LuckyDrawEntitlement.countDocuments({ referrerId: referrer })
    ).toBe(1);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: 'lucky-referrer@royalbeads.test', password: TEST_USER.password })
      .expect(200);

    const overview = await agent.get('/api/rewards/lucky-draw').expect(200);
    expect(overview.body.availableSpins).toBe(1);
    expect(overview.body.prizes.length).toBeGreaterThan(0);

    const spin = await agent.post('/api/rewards/lucky-draw/spin').expect(200);
    expect(spin.body.prize.amount).toBeGreaterThan(0);
    expect(spin.body.reference).toBeTruthy();

    // One wallet credit and one unified reward entry.
    expect(
      await Transaction.countDocuments({
        userId: referrer,
        type: TransactionType.LUCKY_DRAW_REWARD,
      })
    ).toBe(1);
    const { RewardLedger } = await import('../src/models/RewardLedger');
    expect(
      await RewardLedger.countDocuments({ userId: referrer, feature: 'LUCKY_DRAW' })
    ).toBe(1);

    // No spins left — a refreshed/retried spin fails safely.
    await agent.post('/api/rewards/lucky-draw/spin').expect(400);
    expect(
      await Transaction.countDocuments({
        userId: referrer,
        type: TransactionType.LUCKY_DRAW_REWARD,
      })
    ).toBe(1);
  });

  it('lets an admin manage prizes and see the referral-to-spin audit trail', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    const admin = await adminAgent(app);

    const created = await admin
      .post('/api/admin/rewards/lucky-draw/prizes')
      .send({ label: '₦7,000', amount: 7_000, weight: 10 })
      .expect(201);
    expect(created.body.prize.amount).toBe(7_000);

    await admin
      .patch(`/api/admin/rewards/lucky-draw/prizes/${created.body.prize._id}`)
      .send({ weight: 25, active: false })
      .expect(200);

    expect(await AuditLog.countDocuments({ action: 'luckyDraw.prize.create' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'luckyDraw.prize.update' })).toBe(1);

    await admin.get('/api/admin/rewards/lucky-draw/entitlements').expect(200);
    await admin.get('/api/admin/rewards/lucky-draw/spins').expect(200);
  });
});



describe('Red Envelope', () => {
  it('caps distribution at the budget and winner count, blocks duplicates', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    const admin = await adminAgent(app);

    const campaign = await admin
      .post('/api/admin/rewards/red-envelope/campaigns')
      .send({
        title: 'Eid Giveaway',
        claimCode: 'EIDTEST100',
        totalBudget: 10_000,
        maxWinners: 2,
        minAmount: 1_000,
        maxAmount: 8_000,
        startDate: new Date(Date.now() - 60_000).toISOString(),
        endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    expect(campaign.body.campaign.claimCode).toBe('EIDTEST100');

    const u1 = await register(app, 'env-one@royalbeads.test');
    const u2 = await register(app, 'env-two@royalbeads.test');

    const c1 = await u1.agent
      .post('/api/rewards/red-envelope/claim')
      .send({ code: 'eidtest100' })
      .expect(201);
    expect(c1.body.claim.amount).toBeGreaterThanOrEqual(1_000);

    // Duplicate claim by the same user is blocked.
    await u1.agent.post('/api/rewards/red-envelope/claim').send({ code: 'EIDTEST100' }).expect(409);

    await u2.agent.post('/api/rewards/red-envelope/claim').send({ code: 'EIDTEST100' }).expect(201);

    // Third user: campaign exhausted (winner limit reached).
    const u3 = await register(app, 'env-three@royalbeads.test');
    await u3.agent.post('/api/rewards/red-envelope/claim').send({ code: 'EIDTEST100' }).expect(400);

    const { RedEnvelopeCampaign } = await import('../src/models/RedEnvelopeCampaign');
    const after = await RedEnvelopeCampaign.findById(campaign.body.campaign._id);
    expect(after!.remainingClaims).toBe(0);
    expect(after!.remainingBudget).toBeGreaterThanOrEqual(0);
    expect(after!.totalBudget - after!.remainingBudget).toBeLessThanOrEqual(after!.totalBudget);

    // Invalid codes are rejected.
    await u1.agent.post('/api/rewards/red-envelope/claim').send({ code: 'WRONGCODE' }).expect(404);
  });
});

describe('Weekly Events', () => {
  it('evaluates platform records and pays each winner only once', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    const admin = await adminAgent(app);

    const event = await admin
      .post('/api/admin/rewards/weekly-events')
      .send({
        title: 'Invite 2, get ₦5,000',
        description: 'Refer 2 members this week.',
        requiredReferrals: 2,
        rewardType: 'CASH',
        rewardAmount: 5_000,
        maxWinners: 100,
        startDate: new Date(Date.now() - 60_000).toISOString(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);
    const eventId = event.body.event._id;

    const { userId } = await register(app, 'event-player@royalbeads.test');
    const mine = await User.findById(userId).select('referralCode');
    await register(app, 'event-d1@royalbeads.test', mine!.referralCode);
    await register(app, 'event-d2@royalbeads.test', mine!.referralCode);

    const agent = request.agent(app);
    await agent
      .post('/api/auth/login')
      .send({ email: 'event-player@royalbeads.test', password: TEST_USER.password })
      .expect(200);

    const list = await agent.get('/api/rewards/weekly-events').expect(200);
    const mineProgress = list.body.events.find((e: any) => e.id === eventId);
    expect(mineProgress.participation.currentReferrals).toBeGreaterThanOrEqual(2);

    await agent.post(`/api/rewards/weekly-events/${eventId}/claim`).expect(200);
    // Second claim is blocked — one reward per user per event.
    await agent.post(`/api/rewards/weekly-events/${eventId}/claim`).expect(409);

    expect(
      await Transaction.countDocuments({
        userId,
        type: TransactionType.WEEKLY_EVENT_REWARD,
      })
    ).toBe(1);
  });

  it('enforces the maximum winners limit', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    const admin = await adminAgent(app);

    const event = await admin
      .post('/api/admin/rewards/weekly-events')
      .send({
        title: 'Solo winner',
        description: 'Only the first qualifier is rewarded.',
        requiredReferrals: 0,
        rewardType: 'CASH',
        rewardAmount: 1_000,
        maxWinners: 1,
        startDate: new Date(Date.now() - 60_000).toISOString(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .expect(201);

    const first = await register(app, 'first-winner@royalbeads.test');
    await first.agent.post(`/api/rewards/weekly-events/${event.body.event._id}/claim`).expect(200);

    const second = await register(app, 'second-winner@royalbeads.test');
    await second.agent.post(`/api/rewards/weekly-events/${event.body.event._id}/claim`).expect(400);
  });
});

describe('Audit Mode & withdrawal configuration', () => {
  it('blocks tasks and withdrawals server-side while active', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    await taskService.syncDefinitions();
    const admin = await adminAgent(app);

    const { agent, userId } = await register(app, 'audit-user@royalbeads.test');
    await fund(userId, 60_000);

    // Tasks work before the audit.
    const task = await Task.findOne({ active: true });
    await agent.post(`/api/tasks/${task!._id}/complete`).expect(201);

    // Admin turns Audit Mode on.
    await admin.post('/api/admin/audit-mode').send({ active: true }).expect(200);
    expect(await AuditLog.countDocuments({ action: 'audit.mode.change' })).toBe(1);

    // Tasks are refused with a server-side 403 (no duplicate reward).
    await agent.post(`/api/tasks/${task!._id}/complete`).expect(403);

    // Withdrawal requests are refused server-side too.
    await agent
      .post('/api/wallet/withdrawals')
      .send({
        amount: 10_000,
        bankName: 'GTB',
        accountNumber: '0123456789',
        accountName: 'Test User',
      })
      .expect(403);

    // Admin turns Audit Mode off — normal configured behaviour resumes.
    await admin.post('/api/admin/audit-mode').send({ active: false }).expect(200);
    const settings = (await admin.get('/api/admin/settings').expect(200)).body;
    expect(settings.auditModeActive).toBe(false);
  });

  it('computes the inclusive fee and snapshots it on each withdrawal', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();
    await systemSettingService.updateSettings({ withdrawalFeePercent: 10 } as never);

    const { agent, userId } = await register(app, 'fee-user@royalbeads.test');
    await fund(userId, 60_000);

    const created = await agent
      .post('/api/wallet/withdrawals')
      .send({
        amount: 10_000,
        bankName: 'GTB',
        accountNumber: '0123456789',
        accountName: 'Test User',
      })
      .expect(201);

    // ₦10,000 requested → ₦1,000 fee → ₦9,000 net. Only ₦10,000 is deducted.
    expect(created.body.withdrawal).toMatchObject({
      amount: 10_000,
      fee: 1_000,
      netAmount: 9_000,
      feePercent: 10,
    });

    const admin = await adminAgent(app);

    // Admin changes the fee to 5% for NEW withdrawals…
    await admin.patch('/api/admin/settings').send({ withdrawalFeePercent: 5 }).expect(200);

    // …the historical withdrawal still records its original 10%.
    const { Withdrawal } = await import('../src/models/Withdrawal');
    const historical = await Withdrawal.findById(created.body.withdrawal.id);
    expect(historical!.feePercent).toBe(10);
    expect(historical!.fee).toBe(1_000);

    const created2 = await agent
      .post('/api/wallet/withdrawals')
      .send({
        amount: 10_000,
        bankName: 'GTB',
        accountNumber: '0123456789',
        accountName: 'Test User',
      })
      .expect(201);
    expect(created2.body.withdrawal).toMatchObject({ feePercent: 5, fee: 500, netAmount: 9_500 });
  });

  it('enforces Mon–Fri withdrawal days from configuration', async () => {
    const app = freshApp();
    await bootstrapService.bootstrapAll();

    // Restrict withdrawals to Sundays only so today (whatever it is) is
    // overwhelmingly likely to be rejected — unless today is Sunday, in which
    // case the request would proceed (still a valid configuration assertion).
    await systemSettingService.updateSettings({ withdrawalDays: [0] } as never);
    const today = new Date().getUTCDay();

    const { agent, userId } = await register(app, 'days-user@royalbeads.test');
    await fund(userId, 60_000);

    const res = await agent.post('/api/wallet/withdrawals').send({
      amount: 10_000,
      bankName: 'GTB',
      accountNumber: '0123456789',
      accountName: 'Test User',
    });

    if (today === 0) {
      expect(res.status).toBe(201);
    } else {
      expect(res.status).toBe(403);
    }
  });
});




