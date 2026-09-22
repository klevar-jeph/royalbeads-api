// tests/payments.test.ts
// Integration tests for deposits, withdrawals, and admin approvals.

import request from 'supertest';
import type { Express } from 'express';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { Wallet } from '../src/models/Wallet';
import { Transaction, TransactionType } from '../src/models/Transaction';
import { Deposit, DepositStatus } from '../src/models/Deposit';
import { Withdrawal, WithdrawalStatus } from '../src/models/Withdrawal';
import { taskService } from '../src/services/taskService';
import { Task } from '../src/models/Task';
import { paystackService } from '../src/services/paystackService';

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

/** Give the user some task-reward balance. */
async function seedBalance(userId: string) {
  await taskService.syncDefinitions();
  const checkin = await Task.findOne({ key: 'daily-checkin' });
  await taskService.complete(userId, checkin!._id.toString());
}

const BANK = { bankName: 'GTB', accountNumber: '0123456789', accountName: 'Test User' };

// Deposits are ALWAYS direct Paystack checkouts — spy on the gateway so the
// deposit endpoints can be exercised without real HTTP calls.
let mockInitialize: jest.Mock;

beforeEach(() => {
  process.env.PAYMENT_PROVIDER = 'paystack';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_xxx';
  process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_123';
  delete process.env.PAYSTACK_LIVE_SECRET_KEY;
  delete process.env.PAYSTACK_LIVE_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'development';

  mockInitialize = jest.spyOn(paystackService, 'initialize') as unknown as jest.Mock;
  mockInitialize.mockReset();
  mockInitialize.mockImplementation(
    async (_email: string, _amount: number, reference: string) => ({
      authorizationUrl: `https://checkout.paystack.test/pay/${reference}`,
      accessCode: 'ac_test',
      reference,
    })
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Deposits', () => {
  it('returns payment instructions (paystack provider)', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    const res = await agent.get('/api/wallet/instructions').expect(200);
    expect(res.body.instructions.provider).toBe('paystack');
    expect(res.body.instructions.minWithdrawal).toBeGreaterThan(0);
  });

  it('creates a DIRECT Paystack deposit (PENDING, GATEWAY, with authorization URL)', async () => {
    const { agent, user } = await authenticatedAgent(freshApp());

    const created = await agent
      .post('/api/wallet/deposits')
      .send({ amount: 5000 })
      .expect(201);
    expect(created.body.deposit).toMatchObject({
      amount: 5000,
      status: DepositStatus.PENDING,
      method: 'GATEWAY',
    });
    expect(created.body.deposit.reference).toMatch(/^DEP-/);
    expect(created.body.deposit.authorizationUrl).toMatch(
      /^https:\/\/checkout\.paystack\.test\/pay\/DEP-/
    );
    // No sender information is required or stored.
    expect(created.body.deposit.note ?? null).toBeNull();

    await agent.post('/api/wallet/deposits').send({ amount: 10 }).expect(422);
    void user;
  });

  it('admin review still works on pending deposits (legacy/manual rows)', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const created = await agent
      .post('/api/wallet/deposits')
      .send({ amount: 5000 })
      .expect(201);

    const queue = await admin.get('/api/admin/deposits?status=PENDING').expect(200);
    expect(queue.body.deposits).toHaveLength(1);

    await admin
      .post(`/api/admin/deposits/${created.body.deposit.id}/review`)
      .send({ decision: 'APPROVE', note: 'payment seen' })
      .expect(200);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(5000);

    const ledger = await Transaction.findOne({ userId: user.id, type: TransactionType.DEPOSIT });
    expect(ledger).toMatchObject({ amount: 5000 });

    await admin
      .post(`/api/admin/deposits/${created.body.deposit.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(409);
  });

  it('rejected deposits do not credit the wallet', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const created = await agent.post('/api/wallet/deposits').send({ amount: 2000 }).expect(201);
    await admin
      .post(`/api/admin/deposits/${created.body.deposit.id}/review`)
      .send({ decision: 'REJECT', note: 'no payment found' })
      .expect(200);

    const wallet = await Wallet.findOne({ userId: user.id });
    // No wallet document is ever created on the reject-only path (zero movement).
    expect(wallet?.availableBalance ?? 0).toBe(0);
    const deposit = await Deposit.findById(created.body.deposit.id);
    expect(deposit?.status).toBe(DepositStatus.REJECTED);
  });

  it('lists the user deposit history', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    await agent.post('/api/wallet/deposits').send({ amount: 1000 }).expect(201);
    await agent.post('/api/wallet/deposits').send({ amount: 3000 }).expect(201);
    const res = await agent.get('/api/wallet/deposits').expect(200);
    expect(res.body.deposits).toHaveLength(2);
  });
});

describe('Withdrawals', () => {
  it('rejects below minimum and insufficient balance', async () => {
    const { agent } = await authenticatedAgent(freshApp());

    await agent.post('/api/wallet/withdrawals').send({ amount: 100, ...BANK }).expect(400);
    await agent.post('/api/wallet/withdrawals').send({ amount: 9000, ...BANK }).expect(422);
  });

  it('creates a pending withdrawal; approval debits the wallet; marks paid', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    await seedBalance(user.id); // +50
    await agent.post('/api/wallet/deposits').send({ amount: 5000 }).expect(201);
    const deposits = (await agent.get('/api/wallet/deposits').expect(200)).body.deposits;
    await admin
      .post(`/api/admin/deposits/${deposits[0].id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const created = await agent
      .post('/api/wallet/withdrawals')
      .send({ amount: 5000, ...BANK })
      .expect(201);
    expect(created.body.withdrawal).toMatchObject({
      amount: 5000,
      status: WithdrawalStatus.PENDING,
      bankName: 'GTB',
    });
    expect(created.body.withdrawal.reference).toMatch(/^WDR-/);

    const queue = await admin.get('/api/admin/withdrawals?status=PENDING').expect(200);
    expect(queue.body.withdrawals).toHaveLength(1);

    await admin
      .post(`/api/admin/withdrawals/${created.body.withdrawal.id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(50); // 5050 - 5000

    const ledger = await Transaction.findOne({ userId: user.id, type: TransactionType.WITHDRAWAL });
    expect(ledger).toMatchObject({ amount: -5000, balanceAfter: 50 });

    await admin.post(`/api/admin/withdrawals/${created.body.withdrawal.id}/paid`).expect(200);
    const w = await Withdrawal.findById(created.body.withdrawal.id);
    expect(w?.status).toBe(WithdrawalStatus.PAID);
    expect(w?.paidAt).toBeTruthy();
  });

  it('approval is guarded against an overdrawn balance', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    await seedBalance(user.id); // +50
    await agent.post('/api/wallet/deposits').send({ amount: 5000 }).expect(201);
    const deposits = (await agent.get('/api/wallet/deposits').expect(200)).body.deposits;
    await admin
      .post(`/api/admin/deposits/${deposits[0].id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(200);

    // Manually drain the wallet to simulate a stale/insufficient balance.
    await Wallet.updateOne({ userId: user.id }, { $set: { availableBalance: 10 } });

    const created = await agent
      .post('/api/wallet/withdrawals')
      .send({ amount: 5000, ...BANK })
      .expect(422); // pre-checked: insufficient balance
    void created;

    // Force a pending withdrawal above the balance and verify approval fails.
    const w = await Withdrawal.create({
      userId: user.id,
      amount: 5000,
      bankName: BANK.bankName,
      accountNumber: BANK.accountNumber,
      accountName: BANK.accountName,
      status: WithdrawalStatus.PENDING,
      reference: 'WDR-TEST-1',
    });
    const res = await admin
      .post(`/api/admin/withdrawals/${w._id}/review`)
      .send({ decision: 'APPROVE' })
      .expect(422);
    expect(res.body.message).toMatch(/sufficient balance/i);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(10); // unchanged
  });

  it('requires admin role for review queues', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    await agent.get('/api/admin/deposits').expect(403);
    await agent.get('/api/admin/withdrawals').expect(403);
  });

  it('requires authentication for deposit endpoints', async () => {
    const app = freshApp();
    await request(app).post('/api/wallet/deposits').send({ amount: 1000 }).expect(401);
    await request(app).get('/api/wallet/transactions').expect(401);
  });
});
