// src/services/paystackService.ts
// Paystack gateway integration (sandbox-first).
//
// Credentials (backend env only, never exposed to the client):
//   PAYMENT_PROVIDER=paystack
//   PAYSTACK_SECRET_KEY=sk_test_... | sk_live_...
//   PAYSTACK_WEBHOOK_SECRET=<webhook secret from the dashboard>
//
// Money flow (redirect-based, works on the static-export frontend):
//   1. `POST /api/payments/paystack/initialize` → Paystack `/transaction/initialize`
//      → returns `authorization_url` → the browser navigates there.
//   2. The user pays; Paystack fires `charge.success` at
//      `POST /api/payments/webhook/paystack`.
//   3. The webhook verifies the HMAC-SHA512 signature, re-verifies the
//      transaction server-side (reference + amount), then idempotently credits
//      the wallet through paymentService.

import crypto from 'crypto';

const PAYSTACK_API = 'https://api.paystack.co';

function secret(): string {
  // Live keys take precedence when provided; otherwise the test keys are used.
  const key = process.env.PAYSTACK_LIVE_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY;
  if (process.env.PAYMENT_PROVIDER !== 'paystack' || !key) {
    throw paystackError(
      503,
      'Paystack is not configured. Set PAYMENT_PROVIDER=paystack and PAYSTACK_SECRET_KEY.'
    );
  }
  return key;
}

/** True when the live secret key is in use (informational / safeguards). */
function isLiveMode(): boolean {
  return Boolean(process.env.PAYSTACK_LIVE_SECRET_KEY);
}

function paystackError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret()}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !body.status) {
    throw paystackError(
      res.status >= 400 ? res.status : 502,
      `Paystack request failed: ${body.message ?? res.statusText}`
    );
  }
  return body.data;
}

export interface PaystackInitializeResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface PaystackVerifyResult {
  status: string;
  reference: string;
  amountKobo: number;
  paidAt?: string;
  customerEmail?: string;
}

export const paystackService = {
  /** True when the gateway path is usable (provider + secret key present). */
  isConfigured(): boolean {
    return process.env.PAYMENT_PROVIDER === 'paystack' && Boolean(process.env.PAYSTACK_SECRET_KEY);
  },

  /** Whether live keys are taking precedence (test keys are the fallback). */
  isLiveMode(): boolean {
    return isLiveMode();
  },

  /** Resolved callback URL: live overrides test when set. */
  getCallbackUrl(): string | undefined {
    return process.env.PAYSTACK_LIVE_CALLBACK_URL || process.env.PAYSTACK_CALLBACK_URL || undefined;
  },

  /**
   * Start a card/bank-transfer collection. Amount is converted to kobo.
   * The caller stores `reference` and ties it to a PENDING local Deposit.
   */
  async initialize(
    email: string,
    amountNaira: number,
    reference: string,
    callbackUrl?: string
  ): Promise<PaystackInitializeResult> {
    if (!Number.isInteger(amountNaira) || amountNaira < 100) {
      throw paystackError(400, 'Gateway deposits must be at least ₦100.');
    }
    const data = await paystackFetch<{
      authorization_url: string;
      access_code: string;
      reference: string;
    }>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email,
        amount: amountNaira * 100,
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
      }),
    });
    return {
      authorizationUrl: data.authorization_url,
      accessCode: data.access_code,
      reference: data.reference,
    };
  },

  /** Server-side verification of a completed transaction (source of truth). */
  async verify(reference: string): Promise<PaystackVerifyResult> {
    const data = await paystackFetch<{
      status: string;
      reference: string;
      amount: number;
      paid_at?: string;
      customer: { email: string };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: data.status,
      reference: data.reference,
      amountKobo: data.amount,
      paidAt: data.paid_at,
      customerEmail: data.customer?.email,
    };
  },

  /**
   * Webhook signature check: HMAC-SHA512 of the RAW request body using the
   * webhook secret (falls back to the secret key when unset), compared in
   * constant time against `x-paystack-signature`.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined): boolean {
    if (!signature) return false;
    // Read process.env lazily (not via the cached `env` object) so values set
    // at runtime — e.g. rotating secrets — take effect without a restart.
    // Live webhook secret takes precedence when set.
    const secretValue =
      process.env.PAYSTACK_LIVE_WEBHOOK_SECRET ||
      process.env.PAYSTACK_WEBHOOK_SECRET ||
      process.env.PAYSTACK_LIVE_SECRET_KEY ||
      process.env.PAYSTACK_SECRET_KEY ||
      '';
    if (!secretValue) return false;
    const digest = crypto
      .createHmac('sha512', secretValue)
      .update(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'))
      .digest('hex');
    const left = Buffer.from(digest, 'utf8');
    const right = Buffer.from(signature, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  },

  /** Resolve a bank account name before storing withdrawal details (UI helper). */
  async resolveAccount(
    accountNumber: string,
    bankCode: string
  ): Promise<{ accountNumber: string; accountName: string }> {
    const data = await paystackFetch<{ account_number: string; account_name: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(
        bankCode
      )}`
    );
    return { accountNumber: data.account_number, accountName: data.account_name };
  },

  /** Nigerian bank list for withdrawal-form dropdowns (cached by the caller). */
  async listBanks(): Promise<Array<{ name: string; code: string }>> {
    const data = await paystackFetch<Array<{ name: string; code: string }>>(
      '/bank?country=nigeria&perPage=100'
    );
    return data.map((b) => ({ name: b.name, code: b.code }));
  },
};
