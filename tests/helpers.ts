// tests/helpers.ts
// Shared test utilities: authenticated supertest agent factory + assertions.

import { createApp } from '../src/app';
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
 * Register a user (now active immediately) and log them in.
 * Returns a supertest agent with auth cookies set.
 */
export async function authenticatedAgent(
  app: Express,
  overrides: Partial<TestUser> = {}
): Promise<{ agent: SuperAgentTest; user: any }> {
  const creds = { ...TEST_USER, ...overrides };
  const agent = makeAgent(app);

  const registerRes = await agent
    .post('/api/auth/register')
    .send({
      fullName: creds.fullName,
      email: creds.email,
      phone: creds.phone,
      password: creds.password,
    })
    .expect(201);

  return { agent, user: registerRes.body.user };
}

export function freshApp(): Express {
  return createApp();
}
