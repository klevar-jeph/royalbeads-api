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

// Read NODE_ENV fresh each time so Jest (and runtime secret rotation)
// can mutate it without restarting the process.
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolved Paystack secret key.
 *
 * Selection is driven by `NODE_ENV` (not by whether a live key happens to be
 * set), so the environment fully controls which credentials are used:
 *
 *   NODE_ENV=production  → PAYSTACK_LIVE_SECRET_KEY (required when provider=paystack)
 *   anything else        → PAYSTACK_SECRET_KEY (test/sandbox key)
 *
 * This keeps test/live selection explicit and predictable instead of "live wins
 * if it happens to be set", which made the active key depend on deploy order.
 */
function secret(): string {
  if (process.env.PAYMENT_PROVIDER !== 'paystack') {
    throw paystackError(
      503,
      'Paystack is not configured. Set PAYMENT_PROVIDER=paystack.'
    );
  }

  if (isProduction()) {
    const liveKey = process.env.PAYSTACK_LIVE_SECRET_KEY;
    if (!liveKey) {
      throw paystackError(
        503,
        'Paystack live key is required in production. Set PAYSTACK_LIVE_SECRET_KEY (sk_live_...).'
      );
    }
    return liveKey;
  }

  const testKey = process.env.PAYSTACK_SECRET_KEY;
  if (!testKey) {
    throw paystackError(
      503,
      'Paystack test key is required in non-production. Set PAYSTACK_SECRET_KEY (sk_test_...).'
    );
  }
  return testKey;
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

export interface PaystackTransferResult {
  reference: string;
  transferCode?: string;
  status: string;
  recipientCode: string;
}

export interface PaystackAccountBalance {
  available: number;
  pending?: number;
}

export interface PaystackTransactionSummary {
  reference: string;
  amount: number;
  status: string;
  createdAt: string;
  channel?: string;
}

export const paystackService = {
  /** True when the gateway path is usable (provider + secret key present). */
  isConfigured(): boolean {
    return process.env.PAYMENT_PROVIDER === 'paystack' && Boolean(process.env.PAYSTACK_SECRET_KEY);
  },

  /** Whether the live key is active. False when provider != paystack or not in production. */
  isLiveMode(): boolean {
    return isProduction() && Boolean(process.env.PAYSTACK_LIVE_SECRET_KEY);
  },

  /**
   * Resolved checkout callback URL.
   * NODE_ENV=production → PAYSTACK_LIVE_CALLBACK_URL; otherwise
   * PAYSTACK_CALLBACK_URL. Falls back to undefined when unset.
   */
  getCallbackUrl(): string | undefined {
    return isProduction()
      ? process.env.PAYSTACK_LIVE_CALLBACK_URL || process.env.PAYSTACK_CALLBACK_URL || undefined
      : process.env.PAYSTACK_CALLBACK_URL || undefined;
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

  /** Create a verified recipient for a withdrawal payout. */
  async createRecipient(input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }): Promise<{ recipientCode: string; name: string; accountNumber: string; bankCode: string }> {
    const data = await paystackFetch<{
      recipient_code: string;
      name: string;
      account_number: string;
      bank_code: string;
    }>('/transfer/recipient', {
      method: 'POST',
      body: JSON.stringify({
        type: 'nuban',
        name: input.name,
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        currency: 'NGN',
      }),
    });
    return {
      recipientCode: data.recipient_code,
      name: data.name,
      accountNumber: data.account_number,
      bankCode: data.bank_code,
    };
  },

  /** Initiate a NGN transfer from the platform Paystack balance. */
  async transfer(input: {
    amountNaira: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }): Promise<PaystackTransferResult> {
    if (!Number.isInteger(input.amountNaira) || input.amountNaira <= 0) {
      throw paystackError(400, 'Transfer amount must be a positive whole Naira amount.');
    }
    const data = await paystackFetch<{
      reference: string;
      transfer_code?: string;
      status: string;
      recipient: { recipient_code: string };
    }>('/transfer', {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: input.amountNaira * 100,
        recipient: input.recipientCode,
        reference: input.reference,
        reason: input.reason,
      }),
    });
    return {
      reference: data.reference,
      transferCode: data.transfer_code,
      status: data.status,
      recipientCode: data.recipient.recipient_code,
    };
  },

  /** Current Paystack ledger balance, in kobo. */
  async getBalance(): Promise<PaystackAccountBalance> {
    const data = await paystackFetch<{ available_balance?: number; pending_balance?: number }>('/balance');
    return { available: data.available_balance ?? 0, pending: data.pending_balance };
  },

  /** Recent Paystack transactions, normalised for the admin console. */
  async listTransactions(limit = 20): Promise<PaystackTransactionSummary[]> {
    const data = await paystackFetch<Array<{
      reference: string;
      amount: number;
      status: string;
      created_at: string;
      channel?: string;
    }>>(`/transaction?perPage=${Math.min(Math.max(limit, 1), 100)}`);
    return data.map((transaction) => ({
      reference: transaction.reference,
      amount: transaction.amount,
      status: transaction.status,
      createdAt: transaction.created_at,
      channel: transaction.channel,
    }));
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
    // Webhook secret is selected the same way as the API key: production uses
    // the live webhook secret; everything else uses the test webhook secret.
    // The raw API keys are only used as a last-resort fallback for older setups
    // that configured a webhook secret via the secret key instead.
    const secretValue = isProduction()
      ? process.env.PAYSTACK_LIVE_WEBHOOK_SECRET ||
        process.env.PAYSTACK_LIVE_SECRET_KEY ||
        process.env.PAYSTACK_WEBHOOK_SECRET ||
        process.env.PAYSTACK_SECRET_KEY ||
        ''
      : process.env.PAYSTACK_WEBHOOK_SECRET ||
        process.env.PAYSTACK_SECRET_KEY ||
        process.env.PAYSTACK_LIVE_WEBHOOK_SECRET ||
        process.env.PAYSTACK_LIVE_SECRET_KEY ||
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
