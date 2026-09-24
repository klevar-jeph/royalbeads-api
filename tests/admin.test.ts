// tests/admin.test.ts
// Integration tests for the admin console: user administration, task CRUD,
// withdrawal payout windows/notifications, audit trail and payout export.

import request from 'supertest';
import type { Express } from 'express';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { Wallet } from '../src/models/Wallet';
import { Task } from '../src/models/Task';
import { TaskCompletion } from '../src/models/TaskCompletion';
import { Withdrawal, WithdrawalStatus } from '../src/models/Withdrawal';
import { Notification } from '../src/models/Notification';
import { AuditLog } from '../src/models/AuditLog';
import { walletService } from '../src/services/walletService';
import { taskService } from '../src/services/taskService';
import { TransactionType } from '../src/models/Transaction';

const ADMIN = {
  fullName: 'Ops Admin',
  email: 'ops-admin@royalbeads.test',
  password: TEST_USER.password,
};

const SUPER = {
  fullName: 'Super Admin',
  email: 'super@royalbeads.test',
  password: TEST_USER.password,
};

async function agentFor(
  app: Express,
  creds: { fullName: string; email: string; password: string },
  role: UserRole
) {
  await User.create({
    fullName: creds.fullName,
    email: creds.email,
    passwordHash: creds.password,
    role,
    status: AccountStatus.ACTIVE,
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: creds.email, password: creds.password }).expect(200);
  return agent;
}

/** Give the user some ledger balance (as if earned/credited). */
async function seedBalance(userId: string, amount = 20_000) {
  await walletService.credit(userId, TransactionType.ADJUSTMENT, amount, 'Test seed', {
    idempotencyKey: `admin-seed-${userId}-${amount}`,
  });
}
describe('Admin console', () => {
  let app: Express;

  beforeEach(async () => {
    app = freshApp();
    await TaskCompletion.deleteMany({});
  });

  // --- User administration --------------------------------------------------

  it('returns a full user record with wallet and ledger read-only', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);
    await seedBalance(user.id, 7_500);

    const res = await admin.get(`/api/admin/users/${user.id}`).expect(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
    expect(res.body.wallet.availableBalance).toBe(7_500);
    expect(res.body.transactions.length).toBeGreaterThan(0);
    expect(res.body.metrics).toHaveProperty('taskCompletions');
  });

  it('exposes no endpoint that can modify a wallet or ledger entry', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    // There is deliberately no admin route that edits balances/transactions.
    await admin.post(`/api/admin/users/${user.id}/balance`).send({ amount: 1_000_000 }).expect(404);
    await admin.patch(`/api/admin/wallets/${user.id}`).send({ availableBalance: 0 }).expect(404);
  });

  it('lets an admin reset a user password and notifies the user', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    await admin.post(`/api/admin/users/${user.id}/password`).send({ password: 'NewStr0ngPass!' }).expect(200);

    const login = request.agent(app);
    await login.post('/api/auth/login').send({ email: TEST_USER.email, password: 'NewStr0ngPass!' }).expect(200);

    const notes = await Notification.find({ userId: user.id, title: 'Password changed by support' });
    expect(notes).toHaveLength(1);
    expect(await AuditLog.countDocuments({ action: 'user.password.reset' })).toBe(1);
  });

  it('rejects a short password reset and a non-super-admin role change', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    await admin.post(`/api/admin/users/${user.id}/password`).send({ password: 'short' }).expect(422);
    await admin.post(`/api/admin/users/${user.id}/role`).send({ role: 'ADMIN' }).expect(403);
  });

  it('lets a super admin change a role and records it in the audit log', async () => {
    const { user } = await authenticatedAgent(app);
    const superAdmin = await agentFor(app, SUPER, UserRole.SUPER_ADMIN);

    const res = await superAdmin.post(`/api/admin/users/${user.id}/role`).send({ role: 'SUPPORT' }).expect(200);
    expect(res.body.user.role).toBe('SUPPORT');
    expect(await AuditLog.countDocuments({ action: 'user.role.change' })).toBe(1);
  });

  it('suspends and reactivates an account with audit entries', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    const suspended = await admin.post(`/api/admin/users/${user.id}/status`).send({ status: 'SUSPENDED' }).expect(200);
    expect(suspended.body.user.status).toBe('SUSPENDED');

    const activated = await admin.post(`/api/admin/users/${user.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    expect(activated.body.user.status).toBe('ACTIVE');
    expect(await AuditLog.countDocuments({ action: /^user\.status\./ })).toBe(2);
  });
});
describe('Admin console — withdrawals and tasks', () => {
  let app: Express;

  beforeEach(async () => {
    app = freshApp();
    await TaskCompletion.deleteMany({});
  });

  it('sets a payout window and notifies the user on approval', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);
    await seedBalance(user.id, 10_000);

    const withdrawal = await Withdrawal.create({
      userId: user.id,
      amount: 5_000,
      bankName: 'GTB',
      accountNumber: '0123456789',
      accountName: 'Test User',
      status: WithdrawalStatus.PENDING,
      reference: 'WDR-TEST-1',
    });

    await admin.post(`/api/admin/withdrawals/${withdrawal._id}/review`).send({ decision: 'APPROVE' }).expect(200);

    const approved = await Withdrawal.findById(withdrawal._id);
    expect(approved!.status).toBe(WithdrawalStatus.APPROVED);
    expect(approved!.approvedAt).toBeInstanceOf(Date);
    expect(approved!.payoutEta).toBeInstanceOf(Date);
    expect(approved!.payoutEta!.getTime()).toBeGreaterThan(Date.now());

    const notification = await Notification.findOne({ userId: user.id, title: 'Withdrawal approved' });
    expect(notification!.message).toContain('24–72 working hours');

    // Approval debited the wallet (guarded, no overdraft possible).
    const after = await Wallet.findOne({ userId: user.id });
    expect(after!.availableBalance).toBe(5_000);

    const detail = await admin.get(`/api/admin/users/${user.id}`).expect(200);
    expect(detail.body.withdrawals[0].payoutEta).toBeTruthy();
  });

  it('rejects with a reason and exports approved withdrawals as CSV', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    const rejected = await Withdrawal.create({
      userId: user.id,
      amount: 2_000,
      bankName: 'GTB',
      accountNumber: '0123456789',
      accountName: 'Test User',
      status: WithdrawalStatus.PENDING,
      reference: 'WDR-TEST-REJECT',
    });
    await admin
      .post(`/api/admin/withdrawals/${rejected._id}/review`)
      .send({ decision: 'REJECT', note: 'Name mismatch' })
      .expect(200);
    const note = await Notification.findOne({ userId: user.id, title: 'Withdrawal rejected' });
    expect(note!.message).toContain('Name mismatch');

    await Withdrawal.create({
      userId: user.id,
      amount: 3_000,
      bankName: 'GTB',
      accountNumber: '0123456789',
      accountName: 'Test User',
      status: WithdrawalStatus.APPROVED,
      reference: 'WDR-TEST-CSV',
      payoutEta: new Date(),
    });

    const res = await admin.get('/api/admin/withdrawals/export?status=APPROVED').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('WDR-TEST-CSV');
    expect(res.text).toContain('payoutEta');
  });
});
describe('Admin console — task catalog and audit log', () => {
  let app: Express;

  beforeEach(async () => {
    app = freshApp();
    await TaskCompletion.deleteMany({});
  });

  it('creates, updates and deletes tasks and logs each change', async () => {
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    const created = await admin
      .post('/api/admin/tasks')
      .send({
        key: 'watch-promo-x',
        title: 'Watch a promo',
        description: 'Watch the advert to the end',
        reward: 250,
        minVipTier: 3,
        dailyLimit: 2,
      })
      .expect(201);
    expect(created.body.task.reward).toBe(250);
    expect(created.body.task.minVipTier).toBe(3);

    const updated = await admin
      .patch('/api/admin/tasks/watch-promo-x')
      .send({ reward: 400, active: false })
      .expect(200);
    expect(updated.body.task.reward).toBe(400);
    expect(updated.body.task.active).toBe(false);

    await admin.delete('/api/admin/tasks/watch-promo-x').expect(200);
    expect(await Task.findOne({ key: 'watch-promo-x' })).toBeNull();
    expect(await AuditLog.countDocuments({ action: /^task\./ })).toBe(3);
  });

  it('exposes a read-only, filterable audit log', async () => {
    const { user } = await authenticatedAgent(app);
    const admin = await agentFor(app, ADMIN, UserRole.ADMIN);

    await admin.post(`/api/admin/users/${user.id}/status`).send({ status: 'SUSPENDED' }).expect(200);

    const all = await admin.get('/api/admin/audit-logs').expect(200);
    expect(all.body.total).toBeGreaterThan(0);
    expect(all.body.logs[0].actorEmail).toBe(ADMIN.email);

    const filtered = await admin.get('/api/admin/audit-logs?action=user.status.suspended').expect(200);
    expect(filtered.body.logs).toHaveLength(1);
    expect(filtered.body.logs[0].targetId).toBe(user.id);
  });

  it('blocks non-admin accounts from the admin API', async () => {
    const { agent } = await authenticatedAgent(app);
    await agent.get('/api/admin/stats').expect(403);
    await agent.get('/api/admin/audit-logs').expect(403);
  });
});
