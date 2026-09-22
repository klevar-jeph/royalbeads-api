// tests/auth.test.ts
// Integration tests for the authentication flow.

import request from 'supertest';
import { User, AccountStatus } from '../src/models/User';
import { freshApp, authenticatedAgent, TEST_USER } from './helpers';

describe('Auth flow', () => {
  it('registers a new user and logs them in immediately', async () => {
    const app = freshApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        fullName: 'Jane Doe',
        email: 'jane@royalbeads.test',
        phone: '+234 800 111 1111',
        password: 'Str0ngPass!',
      })
      .expect(201);

    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('jane@royalbeads.test');
    expect(res.body.user.status).toBe(AccountStatus.ACTIVE);
    expect(res.body.user.emailVerified).toBe(true);
  });

  it('rejects duplicate email registration', async () => {
    const app = freshApp();
    await request(app).post('/api/auth/register').send({ ...TEST_USER }).expect(201);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...TEST_USER, email: TEST_USER.email })
      .expect(409);
    expect(res.body.message).toMatch(/already exists/i);
  });

  it('logs in an active user and sets httpOnly cookies', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'login@royalbeads.test' });
    // Authenticated request to /me should succeed.
    const me = await agent.get('/api/users/me').expect(200);
    expect(me.body.user.email).toBe('login@royalbeads.test');
  });

  it('refreshes tokens via the refresh cookie', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'refresh@royalbeads.test' });
    const res = await agent.post('/api/auth/refresh').expect(200);
    expect(res.body.message).toMatch(/refreshed/i);
  });

  it('logs out and clears auth cookies', async () => {
    const app = freshApp();
    const { agent } = await authenticatedAgent(app, { email: 'logout@royalbeads.test' });
    await agent.post('/api/auth/logout').expect(200);
    // After logout, /me should be unauthorized.
    await agent.get('/api/users/me').expect(401);
  });

  it('blocks unauthenticated dashboard access', async () => {
    const app = freshApp();
    await request(app).get('/api/users/me/dashboard').expect(401);
  });

  it('rejects login with wrong password', async () => {
    const app = freshApp();
    await request(app)
      .post('/api/auth/register')
      .send({ fullName: 'Wrong', email: 'wrong@royalbeads.test', password: 'Str0ngPass!' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrong@royalbeads.test', password: 'WrongPass1' })
      .expect(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });
});
