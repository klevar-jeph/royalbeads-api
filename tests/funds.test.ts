// tests/funds.test.ts
// Fund/Investment feature: user catalogue + wallet-backed investing + My Fund
// records, admin CRUD/status control/investor view, the security password and
// the Mine → Total Earning Balance definition.

import request from 'supertest';
import type { Express } from 'express';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { Fund, FundStatus, FundCategory } from '../src/models/Fund';
import { FundInvestment, FundInvestmentStatus } from '../src/models/FundInvestment';
import { Wallet } from '../src/models/Wallet';
import { TransactionType } from '../src/models/Transaction';
import { walletService } from '../src/services/walletService';

const ADMIN = {
  fullName: 'Ops Admin',
  email: 'ops@royalbeads.test',
  password: TEST_USER.password,
};

async function adminAgent(app: Express) {
  await User.create({
    fullName: ADMIN.fullName,
    email: ADMIN.email,
    passwordHash: ADMIN.password,
    role: UserRole.ADMIN,
    status: AccountStatus.ACTIVE,
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  return agent;
}

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const SAMPLE_FUND = {
  name: '30-Day Growth Fund',
  category: 'SHORT_TERM',
  amount: 10_000,
  durationDays: 30,
  expectedReturn: '₦11,000 (10%)',
  description: 'Short-term growth fund.',
  startDate: isoInDays(0),
  endDate: isoInDays(30),
};

describe('Funds (user)', () => {
  it('requires authentication for the fund routes', async () => {
    const app = freshApp();
    await request(app).get('/api/funds').expect(401);
    await request(app).get('/api/funds/mine').expect(401);
    await request(app).post('/api/funds/654321098765432109876543/invest').expect(401);
  });

  it('lists visible funds with full details and hides deactivated ones', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await Fund.create(SAMPLE_FUND);
    await Fund.create({ ...SAMPLE_FUND, name: 'Hidden Fund', status: FundStatus.INACTIVE });
    await Fund.create({
      ...SAMPLE_FUND,
      name: 'Long Growth',
      category: FundCategory.LONG_TERM,
      startDate: isoInDays(0),
      endDate: isoInDays(400),
      durationDays: 400,
    });

    const res = await agent.get('/api/funds').expect(200);
    const names = res.body.funds.map((f: { name: string }) => f.name);
    expect(names).toContain('30-Day Growth Fund');
    expect(names).toContain('Long Growth');
    expect(names).not.toContain('Hidden Fund');

    const fund = res.body.funds.find((f: { name: string }) => f.name === '30-Day Growth Fund');
    expect(fund).toMatchObject({
      category: 'SHORT_TERM',
      amount: 10_000,
      durationDays: 30,
      expectedReturn: '₦11,000 (10%)',
      status: 'ACTIVE',
    });
    expect(fund.startDate).toBeTruthy();
    expect(fund.endDate).toBeTruthy();
  });

  it('invests from the wallet, debits the balance and records My Fund', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const fund = await Fund.create(SAMPLE_FUND);
    await Wallet.create({ userId: user.id, availableBalance: 50_000 });

    const res = await agent.post(`/api/funds/${fund._id}/invest`).expect(201);
    expect(res.body.investment).toMatchObject({
      fundName: '30-Day Growth Fund',
      amount: 10_000,
      status: 'ACTIVE',
      category: 'SHORT_TERM',
    });

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(40_000);

    const mine = await agent.get('/api/funds/mine').expect(200);
    expect(mine.body.investments).toHaveLength(1);
    expect(mine.body.investments[0]).toMatchObject({
      fundId: fund._id.toString(),
      amount: 10_000,
      expectedReturn: '₦11,000 (10%)',
    });
    expect(mine.body.investments[0].investedAt).toBeTruthy();
    expect(mine.body.investments[0].maturesAt).toBeTruthy();
  });

  it('rejects investing with an insufficient wallet balance', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const fund = await Fund.create(SAMPLE_FUND);
    await Wallet.create({ userId: user.id, availableBalance: 500 });

    await agent.post(`/api/funds/${fund._id}/invest`).expect(422);
    expect(await FundInvestment.countDocuments({ userId: user.id })).toBe(0);
    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(500);
  });

  it('blocks investing in sold-out, completed, deactivated or ended funds', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await Wallet.create({ userId: user.id, availableBalance: 1_000_000 });

    const soldOut = await Fund.create({ ...SAMPLE_FUND, status: FundStatus.SOLD_OUT });
    const completed = await Fund.create({ ...SAMPLE_FUND, name: 'Done Fund', status: FundStatus.COMPLETED });
    const inactive = await Fund.create({ ...SAMPLE_FUND, name: 'Off Fund', status: FundStatus.INACTIVE });
    const ended = await Fund.create({
      ...SAMPLE_FUND,
      name: 'Ended Fund',
      startDate: isoInDays(-60),
      endDate: isoInDays(-30),
    });

    await agent.post(`/api/funds/${soldOut._id}/invest`).expect(409);
    await agent.post(`/api/funds/${completed._id}/invest`).expect(409);
    await agent.post(`/api/funds/${inactive._id}/invest`).expect(404);
    await agent.post(`/api/funds/${ended._id}/invest`).expect(409);
    expect(await FundInvestment.countDocuments({})).toBe(0);
  });

  it('reports matured investments as MATURED in My Fund', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const fund = await Fund.create(SAMPLE_FUND);
    await FundInvestment.create({
      userId: user.id,
      fundId: fund._id,
      fundName: fund.name,
      category: fund.category,
      amount: fund.amount,
      expectedReturn: fund.expectedReturn,
      startDate: fund.startDate,
      maturesAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: FundInvestmentStatus.ACTIVE,
    });

    const mine = await agent.get('/api/funds/mine').expect(200);
    expect(mine.body.investments[0].status).toBe('MATURED');
  });
});

describe('Mine earnings (Total Earning Balance)', () => {
  it('counts earning credits only — deposits are excluded', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);

    // Deposits and team/task commissions all credit the wallet…
    await walletService.credit(user.id, TransactionType.DEPOSIT, 5_000, 'Deposit confirmed');
    await walletService.credit(user.id, TransactionType.TEAM_COMMISSION, 200, 'Team A commission');
    await walletService.credit(user.id, TransactionType.TASK_REWARD, 100, 'Task reward');

    const dash = await agent.get('/api/users/me/dashboard').expect(200);
    // Lifetime credited… includes the deposit…
    expect(dash.body.summary.totalEarnings).toBe(5_300);
    // …but the Total Earning Balance does not.
    expect(dash.body.summary.totalEarningBalance).toBe(300);

    const earnings = await agent.get('/api/wallet/earnings').expect(200);
    expect(earnings.body.earnings).toEqual({
      total: 300,
      taskRewards: 100,
      teamCommissions: 200,
      referralCommissions: 0,
      salaryClaims: 0,
      rewards: 0,
    });
  });

  it('investments do not reduce or inflate the Total Earning Balance', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await walletService.credit(user.id, TransactionType.TASK_REWARD, 40_000, 'Task rewards');
    await Wallet.updateOne({ userId: user.id }, { $set: { availableBalance: 40_000 } });
    const fund = await Fund.create(SAMPLE_FUND);

    await agent.post(`/api/funds/${fund._id}/invest`).expect(201);

    const dash = await agent.get('/api/users/me/dashboard').expect(200);
    expect(dash.body.summary.totalEarningBalance).toBe(40_000);
    expect(dash.body.summary.availableBalance).toBe(30_000);
  });
});

describe('Security password (Mine → Security)', () => {
  it('sets and changes the security password with the login password', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);

    // Wrong login password is rejected.
    await agent
      .post('/api/users/me/security-password')
      .send({ currentPassword: 'WrongPass1', securityPassword: 'Secur3Pass' })
      .expect(401);

    // First set succeeds and is stored hashed. (The endpoint is rate-limited
    // to 3 attempts per window — this test deliberately stays within it.)
    await agent
      .post('/api/users/me/security-password')
      .send({ currentPassword: TEST_USER.password, securityPassword: 'Secur3Pass' })
      .expect(200);
    const doc = await User.findById(user.id);
    expect(doc?.securityPasswordHash).toBeTruthy();
    expect(doc?.securityPasswordHash).not.toBe('Secur3Pass');

    // Changing it again still requires the login password.
    await agent
      .post('/api/users/me/security-password')
      .send({ currentPassword: TEST_USER.password, securityPassword: 'N3wSecur3Pass' })
      .expect(200);
  });
});

describe('Funds (admin)', () => {
  it('creates, lists, edits and deletes funds and audits every mutation', async () => {
    const app = freshApp();
    const admin = await adminAgent(app);

    // Create.
    const created = await admin.post('/api/admin/funds').send(SAMPLE_FUND).expect(201);
    expect(created.body.fund).toMatchObject({
      name: '30-Day Growth Fund',
      category: 'SHORT_TERM',
      amount: 10_000,
      durationDays: 30,
      expectedReturn: '₦11,000 (10%)',
      status: 'ACTIVE',
      investorCount: 0,
      totalInvested: 0,
    });

    // List includes investor aggregates.
    const list = await admin.get('/api/admin/funds').expect(200);
    expect(list.body.funds).toHaveLength(1);

    // Edit economics.
    const fundId = created.body.fund.id as string;
    const patched = await admin
      .patch(`/api/admin/funds/${fundId}`)
      .send({ amount: 15_000, durationDays: 45, expectedReturn: '₦17,000 (13%)' })
      .expect(200);
    expect(patched.body.fund).toMatchObject({ amount: 15_000, durationDays: 45 });

    // Mark sold out → users can no longer invest (covered in the user suite).
    await admin.patch(`/api/admin/funds/${fundId}`).send({ status: 'SOLD_OUT' }).expect(200);

    // Delete without investors succeeds; every mutation was audited
    // (create, edit economics, status switch, delete).
    await admin.delete(`/api/admin/funds/${fundId}`).expect(200);
    const { AuditLog } = await import('../src/models/AuditLog');
    expect(await AuditLog.countDocuments({ action: { $in: ['fund.create', 'fund.update', 'fund.delete'] } })).toBe(4);
  });

  it('rejects invalid payloads (bad dates and amounts)', async () => {
    const app = freshApp();
    const admin = await adminAgent(app);

    await admin
      .post('/api/admin/funds')
      .send({ ...SAMPLE_FUND, startDate: isoInDays(30), endDate: isoInDays(10) })
      .expect(422);
    await admin.post('/api/admin/funds').send({ ...SAMPLE_FUND, amount: 0 }).expect(422);
    await admin.post('/api/admin/funds').send({ ...SAMPLE_FUND, category: 'MEGA' }).expect(422);
  });

  it('shows investors per fund and blocks deletion while records exist', async () => {
    const app = freshApp();
    const admin = await adminAgent(app);
    const { agent, user } = await authenticatedAgent(app);

    const created = await admin.post('/api/admin/funds').send(SAMPLE_FUND).expect(201);
    const fundId = created.body.fund.id as string;
    const fund = await Fund.findById(fundId);

    await Wallet.create({ userId: user.id, availableBalance: 25_000 });
    await agent.post(`/api/funds/${fund!._id}/invest`).expect(201);

    const investors = await admin.get(`/api/admin/funds/${fundId}/investors`).expect(200);
    expect(investors.body.investors).toHaveLength(1);
    expect(investors.body.investors[0]).toMatchObject({
      fullName: TEST_USER.fullName,
      email: TEST_USER.email,
      amount: 10_000,
      status: 'ACTIVE',
    });
    expect(investors.body.investors[0].investedAt).toBeTruthy();
    expect(investors.body.investors[0].maturesAt).toBeTruthy();
    expect(investors.body.fund.investorCount).toBe(1);
    expect(investors.body.fund.totalInvested).toBe(10_000);

    // Deletion is blocked while investment records exist.
    await admin.delete(`/api/admin/funds/${fundId}`).expect(409);
    expect(await Fund.countDocuments({})).toBe(1);

    // Deactivating (INACTIVE) is the sanctioned alternative — and hides it
    // from the user catalogue.
    await admin.patch(`/api/admin/funds/${fundId}`).send({ status: 'INACTIVE' }).expect(200);
    const catalogue = await agent.get('/api/funds').expect(200);
    expect(catalogue.body.funds).toHaveLength(0);
  });

  it('is closed to regular users', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await agent.get('/api/admin/funds').expect(403);
    await agent.post('/api/admin/funds').send(SAMPLE_FUND).expect(403);
  });
});
