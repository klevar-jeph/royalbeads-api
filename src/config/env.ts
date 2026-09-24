// src/config/env.ts
// Centralised environment variable loader with validation.
// Ensures required secrets are present at startup and exposes typed helpers.

type NodeEnv = 'development' | 'test' | 'production';

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw === 'true' || raw === '1';
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development') as NodeEnv,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development' || !process.env.NODE_ENV,
  isTest: process.env.NODE_ENV === 'test',

  port: int('PORT', 8000),

  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/royalbeads'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  cookie: {
    secure: process.env.NODE_ENV === 'test' ? false : bool('COOKIE_SECURE', false),
    // SameSite policy: 'lax' is CSRF-safe for top-level navigations while
    // permitting cookies on same-site requests. Use 'none' only if you need
    // third-party cookies (and COOKIE_SECURE must then be true).
    sameSite: (optional('COOKIE_SAMESITE', 'lax') as 'lax' | 'strict' | 'none'),
  },

  frontendUrl: optional('FRONTEND_URL', 'http://localhost:3000'),
  apiUrl: optional('API_URL', 'http://localhost:8000/api'),

  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: int('RATE_LIMIT_MAX', 100),
    authMax: int('RATE_LIMIT_AUTH_MAX', 10),
  },

  email: {
    from: optional('EMAIL_FROM', 'Royalbeads <no-reply@royalbeads.local>'),
    provider: optional('EMAIL_PROVIDER', 'console') as 'console' | 'smtp',
    supportEmail: optional('SUPPORT_EMAIL', 'support@royalbeads.local'),
  },

  payments: {
    /** Payment provider used for deposits: 'manual' (bank transfer reviewed
     * by admins) or a gateway name ('paystack' | 'flutterwave') — gateway
     * implementations land with their credentials enabled. */
    provider: optional('PAYMENT_PROVIDER', 'manual') as 'manual' | 'paystack' | 'flutterwave',
    /** Manual bank-transfer details shown to users when provider = manual. */
    bankName: optional('BANK_NAME', ''),
    bankAccountName: optional('BANK_ACCOUNT_NAME', ''),
    bankAccountNumber: optional('BANK_ACCOUNT_NUMBER', ''),
    /**
     * Paystack credentials — test vs live.
     *
     * Test keys are the default (sandbox). When the corresponding LIVE keys
     * are set (non-empty), they take precedence so going live is purely an
     * env change with no code changes:
     *   PAYSTACK_SECRET_KEY            (sk_test_...)
     *   PAYSTACK_LIVE_SECRET_KEY       (sk_live_..., optional)
     *   PAYSTACK_WEBHOOK_SECRET        (test webhook secret)
     *   PAYSTACK_LIVE_WEBHOOK_SECRET   (live webhook secret, optional)
     *   PAYSTACK_CALLBACK_URL          (checkout redirect, optional)
     *   PAYSTACK_LIVE_CALLBACK_URL     (live redirect, optional)
     * Secrets are read lazily by the gateway modules, never at import.
     */
    paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
    paystackLiveSecretKey: process.env.PAYSTACK_LIVE_SECRET_KEY,
    flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY,
    paystackWebhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET,
    paystackLiveWebhookSecret: process.env.PAYSTACK_LIVE_WEBHOOK_SECRET,
    paystackCallbackUrl: optional('PAYSTACK_CALLBACK_URL', ''),
    paystackLiveCallbackUrl: optional('PAYSTACK_LIVE_CALLBACK_URL', ''),
    /** Paystack transfer recipient code for the platform account (required for payouts/upgrades). */
    paystackPlatformRecipientCode: optional('PAYSTACK_PLATFORM_RECIPIENT_CODE', ''),
  },

  /** Referral commission percentage credited on a downline's first deposit (Phase 7). */
  referralCommissionPercent: int('REFERRAL_COMMISSION_PERCENT', 5),
  /** Minimum withdrawal amount (whole Naira). */
  minWithdrawal: int('MIN_WITHDRAWAL', 5000),

  /**
   * Platform administrator bootstrap credentials.
   *
   * On every server start the API ensures an ADMIN account exists with this
   * username (email used to sign in) and password, so admin access is fully
   * controlled from the environment:
   *   ADMIN_USERNAME=admin@royalbeads.com
   *   ADMIN_PASSWORD=a-long-random-password
   * Update the .env values and restart to change the admin credentials.
   */
  admin: {
    username: optional('ADMIN_USERNAME', '').trim().toLowerCase(),
    password: optional('ADMIN_PASSWORD', ''),
  },
};

export type Env = typeof env;
