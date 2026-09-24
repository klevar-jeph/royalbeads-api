// tests/referrals.test.ts
// Referral commission + admin API tests.

import request from 'supertest';
import crypto from 'crypto';
import type { Express } from 'express';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { Wallet } from '../src/models/Wallet';
import { Transaction, TransactionType } from '../src/models/Transaction';
import { Notification } from '../src/models/Notification';
import { paystackService } from '../src/services/paystackService';

const ADMIN = {
  fullName: 'Root Admin',
  email: 'root@royalbeads.test',
  password: TEST_USER.password,
};

async function adminAgent(app: Express) {
  await User.create({
    fullName: ADMIN.fullName,
    email: ADMIN.email,
    passwordHash: ADMIN.password,
    role: UserRole.SUPER_ADMIN,
    status: AccountStatus.ACTIVE,
  });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }).expect(200);
  return agent;
}

/** Register + activate a user who was referred by `referralCode`. */
async function referredAgent(app: Express, email: string, referralCode: string) {
  const agent = request.agent(app) as unknown as ReturnType<typeof request.agent>;
  await agent
    .post('/api/auth/register')
    .send({ fullName: 'Downline User', email, password: TEST_USER.password, referralCode })
    .expect(201);
  await User.updateOne({ email }, { $set: { status: AccountStatus.ACTIVE } });
  await agent.post('/api/auth/login').send({ email, password: TEST_USER.password }).expect(200);
  return agent;
}

// Deposit creation always goes through the Paystack gateway now — spy on
// initialize so deposit-creation in these tests never makes real HTTP calls.
// Money enters the wallet ONLY via the webhook; `confirmDepositViaWebhook`
// simulates Paystack's charge.success delivery in tests.
let mockVerify: jest.Mock;

beforeEach(() => {
  const mockInitialize = jest.spyOn(paystackService, 'initialize') as unknown as jest.Mock;
  mockInitialize.mockImplementation(
    async (_email: string, _amount: number, reference: string) => ({
      authorizationUrl: `https://checkout.paystack.test/pay/${reference}`,
      accessCode: 'ac_test',
      reference,
    })
  );
  mockVerify = jest.spyOn(paystackService, 'verify') as unknown as jest.Mock;
  mockVerify.mockReset();
});

/**
 * Simulate Paystack's `charge.success` webhook delivery for a deposit —
 * the ONLY path through which a deposit credits the wallet.
 */
async function confirmDepositViaWebhook(
  app: Express,
  reference: string,
  amountNaira: number
): Promise<void> {
  mockVerify.mockReset();
  mockVerify.mockImplementation(async (ref: string) => ({
    status: 'success',
    reference: ref,
    amountKobo: amountNaira * 100,
    paidAt: new Date().toISOString(),
    customerEmail: 'user@example.test',
  }));
  const payload = JSON.stringify({ event: 'charge.success', data: { reference } });
  const sig = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET || 'whsec_test_123')
    .update(payload)
    .digest('hex');
  await request(app)
    .post('/api/payments/webhook/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', sig)
    .send(payload)
    .expect(200);
}

describe('Referrals', () => {
  it('returns the referral summary with code, link, rate and downlines', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await referredAgent(app, 'downline1@royalbeads.test', user.referralCode);

    const res = await agent.get('/api/referrals').expect(200);
    expect(res.body.referrals.referralCode).toBe(user.referralCode);
    expect(res.body.referrals.shareLink).toMatch(/ref=/);
    expect(res.body.referrals.commissionPercent).toBeGreaterThan(0);
    expect(res.body.referrals.total).toBe(1);
    expect(res.body.referrals.downlines[0].email).toBe('downline1@royalbeads.test');
  });

  it('credits the referrer when a downline deposit confirms, exactly once', async () => {
    const app = freshApp();
    const { agent: referrer, user: referrerUser } = await authenticatedAgent(app);
    const downline = await referredAgent(app, 'downline2@royalbeads.test', referrerUser.referralCode);

    const deposit = await downline.post('/api/wallet/deposits').send({ amount: 10_000 }).expect(201);
    // Money enters ONLY via the Paystack webhook (no admin approval step).
    await confirmDepositViaWebhook(app, deposit.body.deposit.reference, 10_000);

    // 5% of 10,000 = 500 credited to the referrer.
    const wallet = await Wallet.findOne({ userId: referrerUser.id });
    expect(wallet?.availableBalance).toBe(500);

    const commissions = await Transaction.find({
      userId: referrerUser.id,
      type: TransactionType.REFERRAL_COMMISSION,
    });
    expect(commissions).toHaveLength(1);
    expect(commissions[0].amount).toBe(500);

    // A second deposit credits another commission (per-deposit idempotency).
    const second = await downline.post('/api/wallet/deposits').send({ amount: 4_000 }).expect(201);
    await confirmDepositViaWebhook(app, second.body.deposit.reference, 4_000);
    const wallet2 = await Wallet.findOne({ userId: referrerUser.id });
    expect(wallet2?.availableBalance).toBe(700); // +200 (5% of 4,000)

    const summary = await referrer.get('/api/referrals').expect(200);
    expect(summary.body.referrals.earnings).toBe(700);

    const dash = await referrer.get('/api/users/me/dashboard').expect(200);
    expect(dash.body.summary.referralEarnings).toBe(700);

    const notes = await Notification.find({ userId: referrerUser.id, type: 'REFERRAL' });
    expect(notes.length).toBeGreaterThan(0);
  });

  it('does not credit referrals for users without a referrer', async () => {
    const app = freshApp();
    const { user } = await authenticatedAgent(app);

    const solo = await authenticatedAgent(app, { email: 'solo@royalbeads.test' });
    const deposit = await solo.agent.post('/api/wallet/deposits').send({ amount: 5000 }).expect(201);
    await confirmDepositViaWebhook(app, deposit.body.deposit.reference, 5000);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance ?? 0).toBe(0);
  });

  it('requires authentication', async () => {
    await request(freshApp()).get('/api/referrals').expect(401);
  });
});

describe('Admin API', () => {
  it('exposes platform stats to admins only', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    await agent.get('/api/admin/stats').expect(403);

    const res = await admin.get('/api/admin/stats').expect(200);
    expect(res.body.stats.users.total).toBeGreaterThan(0);
    expect(res.body.stats.pending).toHaveProperty('deposits');
    expect(res.body.stats.balances).toHaveProperty('totalAvailable');
  });

  it('lists and searches users with balances', async () => {
    const app = freshApp();
    await authenticatedAgent(app, { email: 'searchme@royalbeads.test' });
    const admin = await adminAgent(app);

    const all = await admin.get('/api/admin/users').expect(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);

    const filtered = await admin.get('/api/admin/users?search=searchme').expect(200);
    expect(filtered.body.users).toHaveLength(1);
    expect(filtered.body.users[0].email).toBe('searchme@royalbeads.test');
    expect(filtered.body.users[0]).toHaveProperty('availableBalance');
  });

  it('activates, suspends and deactivates accounts', async () => {
    const app = freshApp();
    const { user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const suspended = await admin
      .post(`/api/admin/users/${user.id}/status`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(suspended.body.user.status).toBe('SUSPENDED');

    await admin.post(`/api/admin/users/${user.id}/status`).send({ status: 'ACTIVE' }).expect(200);
    await admin.post(`/api/admin/users/${user.id}/status`).send({ status: 'NONSENSE' }).expect(422);
    await admin
      .post('/api/admin/users/507f1f77bcf86cd799439011/status')
      .send({ status: 'ACTIVE' })
      .expect(404);
  });

  it('lists the VIP purchase queue and reviews purchases', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const created = await agent.post('/api/vip/purchase').send({ levelCode: 'R1' }).expect(201);
    const queue = await admin.get('/api/admin/vip/purchases?status=PENDING').expect(200);
    expect(queue.body.purchases).toHaveLength(1);
    expect(queue.body.purchases[0].userId).toHaveProperty('email');

    await admin
      .post(`/api/admin/vip/purchases/${created.body.purchase.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const status = await agent.get('/api/vip/me').expect(200);
    expect(status.body.status.current.code).toBe('R1');
  });

  it('blocks non-admin roles from user management and deposit queue is read-only', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await agent.get('/api/admin/users').expect(403);
    await agent.post('/api/admin/users/whatever/status').send({ status: 'ACTIVE' }).expect(403);
  });
});
