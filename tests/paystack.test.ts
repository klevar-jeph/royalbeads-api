// tests/paystack.test.ts
// Paystack integration tests with the gateway HTTP calls mocked.
//
// These cover: initialize flow, webhook signature verification, idempotent
// crediting, amount-mismatch rejection, and the client-polling verify endpoint.
// Set PAYMENT_PROVIDER + keys in CI/e2e to test against the real sandbox.

import request from 'supertest';
import crypto from 'crypto';
import { freshApp, authenticatedAgent } from './helpers';
import { paystackService } from '../src/services/paystackService';
import { Wallet } from '../src/models/Wallet';
import { Transaction, TransactionType } from '../src/models/Transaction';
import { Deposit, DepositStatus } from '../src/models/Deposit';

describe('Paystack signature verification', () => {
  it('accepts a correctly signed payload and rejects the rest', async () => {
    process.env.PAYMENT_PROVIDER = 'paystack';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_xxx';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_123';

    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'DEP-1' } });
    const goodSig = crypto.createHmac('sha512', 'whsec_test_123').update(payload).digest('hex');

    expect(paystackService.verifyWebhookSignature(payload, goodSig)).toBe(true);
    expect(paystackService.verifyWebhookSignature(payload, 'deadbeef')).toBe(false);
    expect(paystackService.verifyWebhookSignature(payload, undefined)).toBe(false);
    expect(paystackService.verifyWebhookSignature(payload + 'x', goodSig)).toBe(false);
  });

  it('reports unconfigured state when credentials are missing', async () => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYSTACK_SECRET_KEY;
    expect(paystackService.isConfigured()).toBe(false);
  });

  it('isLiveMode is true only in production with the live key set', async () => {
    process.env.PAYMENT_PROVIDER = 'paystack';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_xxx';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_123';
    delete process.env.PAYSTACK_LIVE_SECRET_KEY;
    delete process.env.PAYSTACK_LIVE_WEBHOOK_SECRET;

    // Non-production: live key being set should NOT flip isLiveMode.
    process.env.NODE_ENV = 'development';
    process.env.PAYSTACK_LIVE_SECRET_KEY = 'sk_live_xxx';
    process.env.PAYSTACK_LIVE_WEBHOOK_SECRET = 'whsec_live_123';
    expect(paystackService.isLiveMode()).toBe(false);

    // Production without live key: not live.
    process.env.NODE_ENV = 'production';
    delete process.env.PAYSTACK_LIVE_SECRET_KEY;
    delete process.env.PAYSTACK_LIVE_WEBHOOK_SECRET;
    expect(paystackService.isLiveMode()).toBe(false);

    // Production with live key: live.
    process.env.PAYSTACK_LIVE_SECRET_KEY = 'sk_live_xxx';
    process.env.PAYSTACK_LIVE_WEBHOOK_SECRET = 'whsec_live_123';
    expect(paystackService.isLiveMode()).toBe(true);

    // Webhook signature follows the NODE_ENV rule too.
    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'DEP-L' } });
    const liveSig = crypto.createHmac('sha512', 'whsec_live_123').update(payload).digest('hex');
    const testSig = crypto.createHmac('sha512', 'whsec_test_123').update(payload).digest('hex');
    expect(paystackService.verifyWebhookSignature(payload, liveSig)).toBe(true);
    expect(paystackService.verifyWebhookSignature(payload, testSig)).toBe(false);

    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_WEBHOOK_SECRET;
    delete process.env.PAYSTACK_LIVE_SECRET_KEY;
    delete process.env.PAYSTACK_LIVE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'development';
  });

  it('resolves the callback URL by NODE_ENV: production uses the live URL', () => {
    process.env.PAYMENT_PROVIDER = 'paystack';
    process.env.PAYSTACK_CALLBACK_URL = 'https://test.example/callback';
    delete process.env.PAYSTACK_LIVE_CALLBACK_URL;

    // Non-production uses the test callback URL only.
    process.env.NODE_ENV = 'development';
    expect(paystackService.getCallbackUrl()).toBe('https://test.example/callback');

    // Switch to production without a live callback URL -> falls back to the test URL.
    process.env.NODE_ENV = 'production';
    expect(paystackService.getCallbackUrl()).toBe('https://test.example/callback');

    // Production with a live callback URL uses it.
    process.env.PAYSTACK_LIVE_CALLBACK_URL = 'https://live.example/callback';
    expect(paystackService.getCallbackUrl()).toBe('https://live.example/callback');

    delete process.env.PAYMENT_PROVIDER;
    delete process.env.PAYSTACK_CALLBACK_URL;
    delete process.env.PAYSTACK_LIVE_CALLBACK_URL;
    process.env.NODE_ENV = 'development';
  });
});

// --- Paystack deposit flow (HTTP calls mocked) --------------------------------
// We spy directly on the paystackService object (the same instance the app
// imports) instead of jest.mock'ing the module, which avoids module-resolution
// timing issues between the helpers/app import graph and the test file.

let mockInitialize: jest.Mock;
let mockVerify: jest.Mock;

function sign(payload: string): string {
  return crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET || 'whsec_test_123')
    .update(payload)
    .digest('hex');
}

beforeEach(() => {
  process.env.PAYMENT_PROVIDER = 'paystack';
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_xxx';
  process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_123';
  process.env.PAYSTACK_CALLBACK_URL = 'https://test.example/callback';
  delete process.env.PAYSTACK_LIVE_SECRET_KEY;
  delete process.env.PAYSTACK_LIVE_WEBHOOK_SECRET;
  delete process.env.PAYSTACK_LIVE_CALLBACK_URL;
  process.env.NODE_ENV = 'development';

  mockInitialize = jest.spyOn(paystackService, 'initialize') as unknown as jest.Mock;
  mockVerify = jest.spyOn(paystackService, 'verify') as unknown as jest.Mock;
  mockInitialize.mockReset();
  mockVerify.mockReset();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Deposit.deleteMany({});
  await Wallet.deleteMany({});
});

it('credits the wallet from a verified webhook, exactly once', async () => {
  const app = freshApp();
  const { agent, user } = await authenticatedAgent(app);

  // Mock initialize to echo back the reference that was passed in, so the
  // deposit reference matches what Paystack would return.
  mockInitialize.mockImplementation(
    async (_email: string, _amount: number, reference: string) => ({
      authorizationUrl: '',
      accessCode: '',
      reference,
    })
  );
  // Mock verify: accepts any reference, returns the amount that was passed in.
  mockVerify.mockImplementation(
    async (reference: string) => ({
      status: 'success',
      reference,
      amountKobo: 2000 * 100,
      paidAt: new Date().toISOString(),
      customerEmail: 'user@example.test',
    })
  );

  const initRes = await agent
    .post('/api/payments/paystack/initialize')
    .send({ amount: 2000 })
    .expect(201);

  // The real deposit reference comes from the initialize response, NOT a
  // hardcoded value. This is what Paystack will send back in the webhook.
  const reference = initRes.body.deposit.reference;

  const payload = JSON.stringify({ event: 'charge.success', data: { reference } });
  const sig = sign(payload);

  // Tampered signature -> 401, nothing moves.
  await request(app)
    .post('/api/payments/webhook/paystack')
    .send({ event: 'charge.success', data: { reference } })
    .set('x-paystack-signature', 'invalid')
    .expect(401);

  // Real signature -> credits exactly once, even when delivered twice.
  await request(app)
    .post('/api/payments/webhook/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', sig)
    .send(payload)
    .expect(200);
  await request(app)
    .post('/api/payments/webhook/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', sig)
    .send(payload)
    .expect(200);

  const wallet = await Wallet.findOne({ userId: user.id });
  expect(wallet?.availableBalance).toBe(2000);

  const rows = await Transaction.find({ userId: user.id, type: TransactionType.DEPOSIT });
  expect(rows).toHaveLength(1); // idempotent: one credit only

  const deposit = await Deposit.findOne({ reference });
  expect(deposit?.status).toBe(DepositStatus.APPROVED);
});

it('webhook ignores mismatched amounts', async () => {
  const app = freshApp();
  const { agent, user } = await authenticatedAgent(app);

  // Initialize echoes back the reference that was passed in.
  mockInitialize.mockImplementation(
    async (_email: string, _amount: number, reference: string) => ({
      authorizationUrl: '',
      accessCode: '',
      reference,
    })
  );
  // Verify returns a deliberately wrong amount (simulating a tampered/fraudulent
  // charge or a sandbox mismatch) so the webhook rejects the credit.
  mockVerify.mockImplementation(
    async (_reference: string) => ({
      status: 'success',
      reference: 'mismatch',
      amountKobo: 100, // attacker/sandbox mismatch -> 1 Naira instead of 2000
      paidAt: new Date().toISOString(),
      customerEmail: 'attacker@example.test',
    })
  );

  const initRes = await agent
    .post('/api/payments/paystack/initialize')
    .send({ amount: 2000 })
    .expect(201);

  const reference = initRes.body.deposit.reference;
  const payload = JSON.stringify({ event: 'charge.success', data: { reference } });
  const sig = sign(payload);

  await request(app)
    .post('/api/payments/webhook/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', sig)
    .send(payload)
    .expect(200);

  const wallet = await Wallet.findOne({ userId: user.id });
  expect(wallet?.availableBalance ?? 0).toBe(0);
});

it('verify endpoint credits on client-poll fallback', async () => {
  const app = freshApp();
  const { agent, user } = await authenticatedAgent(app);

  // Initialize echoes back the reference that was passed in.
  mockInitialize.mockImplementation(
    async (_email: string, _amount: number, reference: string) => ({
      authorizationUrl: '',
      accessCode: '',
      reference,
    })
  );
  mockVerify.mockImplementation(
    async (reference: string) => ({
      status: 'success',
      reference,
      amountKobo: 1500 * 100,
      paidAt: new Date().toISOString(),
      customerEmail: 'user@example.test',
    })
  );

  const initRes = await agent
    .post('/api/payments/paystack/initialize')
    .send({ amount: 1500 })
    .expect(201);
  const reference = initRes.body.deposit.reference;

  const res = await agent.get(`/api/payments/paystack/verify/${reference}`).expect(200);
  expect(res.body.deposit).toMatchObject({ reference, status: 'APPROVED', verified: true });

  const wallet = await Wallet.findOne({ userId: user.id });
  expect(wallet?.availableBalance).toBe(1500);
});

it('initialize requires authentication', async () => {
  const app = freshApp();
  await request(app).post('/api/payments/paystack/initialize').send({ amount: 1000 }).expect(401);
});
