// tests/helpers.ts
// Shared test utilities: authenticated supertest agent factory + assertions.

import { createApp } from '../src/app';
import { User, AccountStatus } from '../src/models/User';
import request, { type SuperAgentTest } from 'supertest';
import type { Express } from 'express';

export interface TestUser {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
}

export const TEST_USER: TestUser = {
  fullName: 'Test User',
  email: 'test@royalbeads.test',
  phone: '+234 800 000 0000',
  password: 'Str0ngPass!',
};

/** A supertest agent that persists cookies across requests. */
export type Agent = SuperAgentTest;

function makeAgent(app: Express): SuperAgentTest {
  return request.agent(app) as unknown as SuperAgentTest;
}

/**
 * Register a user (status PENDING_VERIFICATION), then activate them directly
 * in the DB and log in. Returns a supertest agent with auth cookies set.
 */
export async function authenticatedAgent(
  app: Express,
  overrides: Partial<TestUser> = {}
): Promise<{ agent: SuperAgentTest; user: any }> {
  const creds = { ...TEST_USER, ...overrides };
  const agent = makeAgent(app);

  await agent
    .post('/api/auth/register')
    .send({
      fullName: creds.fullName,
      email: creds.email,
      phone: creds.phone,
      password: creds.password,
    })
    .expect(201);

  // Activate the user directly (skip email verification for the common case).
  await User.updateOne({ email: creds.email }, { $set: { status: AccountStatus.ACTIVE } });

  const loginRes = await agent
    .post('/api/auth/login')
    .send({ email: creds.email, password: creds.password })
    .expect(200);

  return { agent, user: loginRes.body.user };
}

/** Register but do NOT activate – returns the email verification token. */
export async function registerPending(
  app: Express,
  overrides: Partial<TestUser> = {}
): Promise<{ agent: SuperAgentTest; email: string; verificationToken: string }> {
  const creds = { ...TEST_USER, ...overrides };
  const agent = makeAgent(app);

  await agent
    .post('/api/auth/register')
    .send({
      fullName: creds.fullName,
      email: creds.email,
      phone: creds.phone,
      password: creds.password,
    })
    .expect(201);

  const user = await User.findOne({ email: creds.email }).select('+emailVerificationToken');
  return {
    agent,
    email: creds.email,
    verificationToken: user?.emailVerificationToken ?? '',
  };
}

export function freshApp(): Express {
  return createApp();
}
