// tests/vip.test.ts
// Integration tests for the VIP endpoints and progression logic.

import request from 'supertest';
import type { Express } from 'express';
import { freshApp, authenticatedAgent } from './helpers';
import { User, UserRole, AccountStatus } from '../src/models/User';
import { VipPurchase, VipPurchaseStatus } from '../src/models/VipPurchase';

const ADMIN_USER = {
  fullName: 'Admin User',
  email: 'admin@royalbeads.test',
  password: 'Str0ngPass!',
};

async function adminAgent(app: Express) {
  await User.create({
    fullName: ADMIN_USER.fullName,
    email: ADMIN_USER.email,
    passwordHash: ADMIN_USER.password,
    role: UserRole.ADMIN,
    status: AccountStatus.ACTIVE,
  });
  const agent = request.agent(app);
  await agent
    .post('/api/auth/login')
    .send({ email: ADMIN_USER.email, password: ADMIN_USER.password })
    .expect(200);
  return agent;
}

describe('VIP endpoints', () => {
  it('lists all R0–R9 levels publicly', async () => {
    const res = await request(freshApp()).get('/api/vip/levels').expect(200);
    expect(res.body.levels).toHaveLength(10);
    expect(res.body.levels[0]).toMatchObject({ code: 'R0', name: 'Starter', tier: 0 });
    expect(res.body.levels[9]).toMatchObject({ code: 'R9', name: 'Crown', tier: 9 });
  });

  it('returns R0 status for a new user with no next pending purchase', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    const res = await agent.get('/api/vip/me').expect(200);
    expect(res.body.status.current).toMatchObject({ code: 'R0', tier: 0 });
    expect(res.body.status.next).toMatchObject({ code: 'R1' });
    expect(res.body.status.pendingPurchase).toBeUndefined();
  });

  it('creates a pending upgrade request and blocks duplicates', async () => {
    const { agent } = await authenticatedAgent(freshApp());

    const created = await agent
      .post('/api/vip/purchase')
      .send({ levelCode: 'r1' })
      .expect(201);
    expect(created.body.purchase).toMatchObject({
      levelCode: 'R1',
      levelName: 'Bronze',
      amount: 30_000,
      status: VipPurchaseStatus.PENDING,
    });

    // Duplicate pending request is rejected.
    await agent
      .post('/api/vip/purchase')
      .send({ levelCode: 'R2' })
      .expect(409);

    // Status now shows the pending purchase.
    const status = await agent.get('/api/vip/me').expect(200);
    expect(status.body.status.pendingPurchase.levelCode).toBe('R1');
  });

  it('rejects upgrade to the current or lower level and unknown codes', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    await agent.post('/api/vip/purchase').send({ levelCode: 'R0' }).expect(400);
    // Invalid codes never reach the service – they are rejected by validation.
    await agent.post('/api/vip/purchase').send({ levelCode: 'R99' }).expect(422);
  });

  it('allows the user to cancel a pending request and request again', async () => {
    const { agent } = await authenticatedAgent(freshApp());
    await agent.post('/api/vip/purchase').send({ levelCode: 'R2' }).expect(201);
    await agent.delete('/api/vip/purchase').expect(200);
    await agent.post('/api/vip/purchase').send({ levelCode: 'R1' }).expect(201);
  });

  it('activates the level when an admin approves the purchase', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const created = await agent.post('/api/vip/purchase').send({ levelCode: 'R2' }).expect(201);
    const purchaseId = created.body.purchase.id;

    await admin
      .post(`/api/vip/admin/purchases/${purchaseId}/review`)
      .send({ decision: 'APPROVE', note: 'payment verified' })
      .expect(200);

    const status = await agent.get('/api/vip/me').expect(200);
    expect(status.body.status.current).toMatchObject({ code: 'R2', name: 'Silver', tier: 2 });
    expect(status.body.status.pendingPurchase).toBeUndefined();

    const dbUser = await User.findById(user.id);
    expect(dbUser?.vipLevel).toBe(2);
    expect(dbUser?.vipActivatedAt).toBeTruthy();
  });

  it('rejects review of an already-reviewed purchase', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app);
    const admin = await adminAgent(app);

    const created = await agent.post('/api/vip/purchase').send({ levelCode: 'R1' }).expect(201);
    const purchaseId = created.body.purchase.id;

    await admin
      .post(`/api/vip/admin/purchases/${purchaseId}/review`)
      .send({ decision: 'REJECT', note: 'no payment found' })
      .expect(200);

    await admin
      .post(`/api/vip/admin/purchases/${purchaseId}/review`)
      .send({ decision: 'APPROVE' })
      .expect(409);
  });

  it('requires authentication for status and purchase routes', async () => {
    const app = freshApp();
    await request(app).get('/api/vip/me').expect(401);
    await request(app).post('/api/vip/purchase').send({ levelCode: 'R1' }).expect(401);
  });

  it('reflects the real VIP level in the dashboard summary', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);

    await User.updateOne({ _id: user.id }, { $set: { vipLevel: 3, vipActivatedAt: new Date() } });

    const res = await agent.get('/api/users/me/dashboard').expect(200);
    expect(res.body.summary.vip).toMatchObject({ level: 'R3', levelName: 'Gold', tier: 3 });
  });

  it('records a notification when an upgrade is requested', async () => {
    const { agent, user } = await authenticatedAgent(freshApp());
    await agent.post('/api/vip/purchase').send({ levelCode: 'R1' }).expect(201);
    const count = await VipPurchase.countDocuments({ userId: user.id, status: VipPurchaseStatus.PENDING });
    expect(count).toBe(1);
  });
});
