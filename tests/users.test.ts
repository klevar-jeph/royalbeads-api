// tests/users.test.ts
// Integration tests for user profile, dashboard, and API security.

import { User } from '../src/models/User';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';

describe('User profile & dashboard', () => {
  it('returns the current user via GET /api/users/me', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'me@royalbeads.test' });
    const res = await agent.get('/api/users/me').expect(200);
    expect(res.body.user.email).toBe('me@royalbeads.test');
    expect(res.body.user.fullName).toBe(TEST_USER.fullName);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('emailVerificationToken');
    expect(res.body.user).toHaveProperty('referralCode');
  });

  it('updates editable profile fields via PATCH /api/users/me', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'update@royalbeads.test' });
    const res = await agent
      .patch('/api/users/me')
      .send({ fullName: 'Updated Name', phone: '+234 800 999 0000' })
      .expect(200);
    expect(res.body.user.fullName).toBe('Updated Name');
    expect(res.body.user.phone).toBe('+234 800 999 0000');
  });

  it('rejects attempts to modify protected fields (role/status)', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app, { email: 'protect@royalbeads.test' });

    const res = await agent
      .patch('/api/users/me')
      .send({
        fullName: 'Hacker',
        role: 'SUPER_ADMIN',
        status: 'SUSPENDED',
        passwordHash: 'whatever',
        referralCode: 'HACK1234',
      })
      .expect(200);

    // fullName accepted, privileged fields ignored.
    expect(res.body.user.role).toBe('USER');
    expect(res.body.user.status).toBe('ACTIVE');
    expect(res.body.user.referralCode).toBe(user.referralCode);

    // Confirm in DB that role/status were not changed.
    const dbUser = await User.findById(user.id);
    expect(dbUser?.role).toBe('USER');
    expect(dbUser?.status).toBe('ACTIVE');
  });

  it('updates notification preferences', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'prefs@royalbeads.test' });
    const res = await agent
      .patch('/api/users/me/preferences')
      .send({ email: false, marketing: true })
      .expect(200);
    expect(res.body.user.preferences.email).toBe(false);
    expect(res.body.user.preferences.marketing).toBe(true);
  });

  it('returns the dashboard summary with zero financial placeholders', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'dash@royalbeads.test' });
    const res = await agent.get('/api/users/me/dashboard').expect(200);
    const s = res.body.summary;
    expect(s.user.email).toBe('dash@royalbeads.test');
    expect(s.availableBalance).toBe(0);
    expect(s.totalEarnings).toBe(0);
    expect(s.totalDeposits).toBe(0);
    expect(s.totalWithdrawals).toBe(0);
    expect(s.referralEarnings).toBe(0);
    expect(s.vip.level).toBe('R0');
    expect(s.tasks).toEqual({ available: 0, completed: 0 });
    expect(s.notifications.unread).toBe(0);
  });

  it('user A cannot access user B profile data', async () => {
    const app = freshApp();
    const { agent: agentA } = await authenticatedAgent(app, { email: 'usera@royalbeads.test' });
    await authenticatedAgent(app, { email: 'userb@royalbeads.test' });

    // The /me endpoint always returns the *current* user; there is no
    // userId query param. Verify there's no way to fetch another user.
    const me = await agentA.get('/api/users/me').expect(200);
    expect(me.body.user.email).toBe('usera@royalbeads.test');

    // There is no /api/users/:id route exposed.
    await agentA.get('/api/users/another-id').expect(404);
  });

  it('validates profile update payload', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'validate@royalbeads.test' });
    await agent.patch('/api/users/me').send({ fullName: '' }).expect(422);
  });

  it('rejects invalid authentication (no token)', async () => {
    const app = freshApp();
    // A plain request (no persisted cookies) carries no auth.
    const request = (await import('supertest')).default;
    await request(app).get('/api/users/me').expect(401);
  });
});
