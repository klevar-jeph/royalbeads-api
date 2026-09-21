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

    const payload = JSON.stringify({ event: 'charge.success', data: { reference: 'PSK-1' } });
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
});

describe('Paystack deposit flow (mocked gateway)', () => {
  const mockInit = jest.fn();
  const mockVerifyRef = jest.fn();

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = 'paystack';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_xxx';
    process.env.PAYSTACK_WEBHOOK_SECRET = 'whsec_test_123';
    mockInit.mockReset();
    mockVerifyRef.mockReset();
    // Default: gateway returns a valid checkout for any initialize call.
    mockInit.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/mock',
      accessCode: 'mock',
      reference: 'PSK-MOCK-REF',
    });
    jest.spyOn(paystackService, 'initialize').mockImplementation(mockInit);
    jest.spyOn(paystackService, 'verify').mockImplementation(mockVerifyRef);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function sign(payload: string): string {
    return crypto.createHmac('sha512', 'whsec_test_123').update(payload).digest('hex');
  }

  it('initialize creates a PENDING deposit and returns the checkout URL', async () => {
    mockInit.mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/abc',
      accessCode: 'abc',
      reference: 'PSK-REF-1',
    });

    const { agent } = await authenticatedAgent(freshApp());
    const res = await agent
      .post('/api/payments/paystack/initialize')
      .send({ amount: 2000 })
      .expect(201);

    expect(res.body.authorizationUrl).toBe('https://checkout.paystack.com/abc');
    expect(res.body.deposit).toMatchObject({ amount: 2000, status: DepositStatus.PENDING });

    const local = await Deposit.findOne({ reference: res.body.deposit.reference });
    expect(local?.method).toBe('GATEWAY');
  });

  it('webhook rejects bad signatures and honours idempotency', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);

    const initRes = await agent
      .post('/api/payments/paystack/initialize')
      .send({ amount: 2000 })
      .expect(201);
    const reference = initRes.body.deposit.reference;

    mockInit.mockImplementation(async () => ({ authorizationUrl: '', accessCode: '', reference }));
    mockVerifyRef.mockResolvedValue({
      status: 'success',
      reference,
      amountKobo: 2000 * 100,
    });

    // Tampered signature → 401, nothing moves.
    await request(app)
      .post('/api/payments/webhook/paystack')
      .send({ event: 'charge.success', data: { reference } })
      .set('x-paystack-signature', 'invalid')
      .expect(401);

    // Real signature → credits exactly once, even when delivered twice.
    const payload = JSON.stringify({ event: 'charge.success', data: { reference } });
    await request(app)
      .post('/api/payments/webhook/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(payload))
      .send(payload)
      .expect(200);
    await request(app)
      .post('/api/payments/webhook/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(payload))
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

    const initRes = await agent
      .post('/api/payments/paystack/initialize')
      .send({ amount: 2000 })
      .expect(201);
    const reference = initRes.body.deposit.reference;

    mockVerifyRef.mockResolvedValue({
      status: 'success',
      reference,
      amountKobo: 100, // attacker/sandbox mismatch
    });

    const payload = JSON.stringify({ event: 'charge.success', data: { reference } });
    await request(app)
      .post('/api/payments/webhook/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', sign(payload))
      .send(payload)
      .expect(200);

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance ?? 0).toBe(0);
  });

  it('verify endpoint credits on client-poll fallback', async () => {
    const app = freshApp();
    const { agent, user } = await authenticatedAgent(app);

    const initRes = await agent
      .post('/api/payments/paystack/initialize')
      .send({ amount: 1500 })
      .expect(201);
    const reference = initRes.body.deposit.reference;

    mockVerifyRef.mockResolvedValue({
      status: 'success',
      reference,
      amountKobo: 1500 * 100,
    });

    const res = await agent.get(`/api/payments/paystack/verify/${reference}`).expect(200);
    expect(res.body.deposit).toMatchObject({ reference, status: 'APPROVED', verified: true });

    const wallet = await Wallet.findOne({ userId: user.id });
    expect(wallet?.availableBalance).toBe(1500);
  });

  it('initialize requires authentication', async () => {
    const app = freshApp();
    await request(app).post('/api/payments/paystack/initialize').send({ amount: 1000 }).expect(401);
  });
});
