// tests/tasks.test.ts
// Integration tests for the tasks & rewards engine and the wallet ledger.

import request from 'supertest';
import { freshApp, authenticatedAgent } from './helpers';
import { taskService } from '../src/services/taskService';
import { Wallet } from '../src/models/Wallet';
import { Transaction, TransactionType } from '../src/models/Transaction';
import { TaskCompletion } from '../src/models/TaskCompletion';
import { Task } from '../src/models/Task';

describe('Tasks & rewards', () => {
  it("seeds definitions and lists today's tasks for a new user", async () => {
    const { agent } = await authenticatedAgent(freshApp());
    const res = await agent.get('/api/tasks').expect(200);
    expect(res.body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.items).toHaveLength(4);
    // VIP-gated tasks are locked for an R0 user.
    const locked = res.body.items.filter((t: any) => t.locked);
    expect(locked.length).toBe(2); // survey (R1) + social-share (R2)
    expect(res.body.completedToday).toBe(0);
  });

  it('completes a task, credits the wallet, and records a ledger entry', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await taskService.syncDefinitions();

    const checkin = await Task.findOne({ key: 'daily-checkin' });

    const res = await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);
    expect(res.body.reward).toBe(50);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(50);
    expect(wallet?.totalEarned).toBe(50);

    const ledger = await Transaction.find({ userId: user.id });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ type: TransactionType.TASK_REWARD, amount: 50, balanceAfter: 50 });
  });

  it('enforces the daily limit (409 on repeat)', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const checkin = await Task.findOne({ key: 'daily-checkin' });

    await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);
    const res = await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(409);
    expect(res.body.message).toMatch(/already completed/i);
  });

  it("blocks tasks above the user's VIP tier (403)", async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const survey = await Task.findOne({ key: 'survey' });

    const res = await agent.post(`/api/tasks/${survey!._id}/complete`).expect(403);
    expect(res.body.message).toMatch(/VIP level R1/i);
  });

  it('unlocks higher-tier tasks once the VIP level rises', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await taskService.syncDefinitions();

    const survey = await Task.findOne({ key: 'survey' });
    await agent.post(`/api/tasks/${survey!._id}/complete`).expect(403);

    const { User } = await import('../src/models/User');
    await User.updateOne({ _id: user.id }, { $set: { vipLevel: 1 } });

    const res = await agent.post(`/api/tasks/${survey!._id}/complete`).expect(201);
    expect(res.body.reward).toBe(250);
  });

  it('lists completion history', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const checkin = await Task.findOne({ key: 'daily-checkin' });
    await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);

    const res = await agent.get('/api/tasks/me/completions').expect(200);
    expect(res.body.completions).toHaveLength(1);
    expect(res.body.completions[0]).toMatchObject({ taskKey: 'daily-checkin', reward: 50 });
  });

  it('reflects wallet balance and task counters in the dashboard summary', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const checkin = await Task.findOne({ key: 'daily-checkin' });
    await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);

    const res = await agent.get('/api/users/me/dashboard').expect(200);
    expect(res.body.summary.availableBalance).toBe(50);
    expect(res.body.summary.totalEarnings).toBe(50);
    expect(res.body.summary.tasks.completed).toBe(1);
    expect(res.body.summary.tasks.available).toBeGreaterThan(0);
  });

  it('requires authentication', async () => {
    const app = freshApp();
    await request(app).get('/api/tasks').expect(401);
    await request(app).post('/api/tasks/whatever/complete').expect(401);
  });
});

describe('Wallet ledger integrity', () => {
  it('prevents debits below zero and records ledger history', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const checkin = await Task.findOne({ key: 'daily-checkin' });
    await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);

    // The service refuses a debit larger than the balance.
    const { walletService } = await import('../src/services/walletService');
    await expect(
      walletService.debit(user.id, TransactionType.WITHDRAWAL, 500, 'Attempted overdraft')
    ).rejects.toMatchObject({ status: 422 });

    // A debit within balance succeeds and appends to the ledger.
    await walletService.debit(user.id, TransactionType.ADJUSTMENT, 20, 'Test adjustment');
    const ledger = await Transaction.find({ userId: user.id }).sort({ createdAt: 1 });
    expect(ledger.map((t) => t.amount)).toEqual([50, -20]);
    expect(ledger[1].balanceAfter).toBe(30);
  });

  it('is idempotent for retried credits with the same key', async () => {
    const app = freshApp();
    const { user } = await authenticatedAgent(app);
    const { walletService } = await import('../src/services/walletService');

    await walletService.credit(user.id, TransactionType.TASK_REWARD, 100, 'Reward', {
      idempotencyKey: 'same-key',
    });
    await walletService.credit(user.id, TransactionType.TASK_REWARD, 100, 'Reward retry', {
      idempotencyKey: 'same-key',
    });

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(100);
    const ledger = await Transaction.find({ userId: user.id });
    expect(ledger).toHaveLength(1);
  });

  it('wallet endpoint returns balances and ledger', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    await taskService.syncDefinitions();
    const checkin = await Task.findOne({ key: 'daily-checkin' });
    await agent.post(`/api/tasks/${checkin!._id}/complete`).expect(201);

    const res = await agent.get('/api/wallet').expect(200);
    expect(res.body.wallet).toMatchObject({ availableBalance: 50, totalEarned: 50 });
    expect(res.body.transactions).toHaveLength(1);
    expect(res.body.transactions[0]).toMatchObject({ type: 'TASK_REWARD', amount: 50 });
  });

  it('prevents duplicate completions at the storage level', async () => {
    const app = freshApp();
    const { user } = await authenticatedAgent(app);
    await taskService.syncDefinitions();

    await TaskCompletion.create({
      userId: user.id,
      taskKey: 'daily-checkin',
      taskTitle: 'Daily check-in',
      day: '2026-09-20',
      reward: 50,
    });

    await expect(
      TaskCompletion.create({
        userId: user.id,
        taskKey: 'daily-checkin',
        taskTitle: 'Daily check-in',
        day: '2026-09-20',
        reward: 50,
      })
    ).rejects.toThrow();
  });
});
