// src/utils/index.ts
// Shared utility functions used across the backend.

/** Generate a short, URL-safe deposit/transaction identifier (8 chars). */
export function generateDepositId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Format a number as a Nigerian Naira string with comma separators. */
export function formatNaira(amount: number): string {
  return `₦${Math.round(amount).toLocaleString('en-NG')}`;
}

/** Parse a "15m" / "7d" / "24h" expiry string into milliseconds. */
export function msFromExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/i);
  if (!match) return 15 * 60 * 1000; // default 15 minutes
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 60_000);
}

/** Clamp a number to a min/max range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Sleep for a given number of milliseconds (for retries/backoff). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
