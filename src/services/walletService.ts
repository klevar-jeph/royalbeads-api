// src/services/walletService.ts
// Wallet service – the ONLY path through which balances change.
//
// Every mutation:
//   1. atomically applies the balance delta with a guarded conditional update
//      (debits can never push a balance below zero), and
//   2. appends a matching entry to the transaction ledger.
//
// Rewards use an idempotency key (meta.idempotencyKey) so a retried credit
// cannot double-pay.

import { Wallet, IWallet } from '../models/Wallet';
import { Transaction, TransactionType, ITransaction } from '../models/Transaction';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** Whole-Naira integer guard: reject fractional or non-finite amounts. */
function assertWholeAmount(amount: number): void {
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount === 0) {
    throw httpError(400, 'Amount must be a non-zero whole Naira amount.');
  }
}

export const walletService = {
  /** Get (creating if necessary) the user's wallet. */
  async getOrCreateWallet(userId: string | Types.ObjectId): Promise<IWallet> {
    const existing = await Wallet.findOne({ userId });
    if (existing) return existing;
    try {
      return await Wallet.create({ userId });
    } catch {
      // Raced with another create – fetch the winner's document.
      const wallet = await Wallet.findOne({ userId });
      if (!wallet) throw httpError(500, 'Unable to initialise wallet.');
      return wallet;
    }
  },

  /** Idempotent credit: skips if a transaction with the same idempotency key exists. */
  async credit(
    userId: string | Types.ObjectId,
    type: TransactionType,
    amount: number,
    description: string,
    options: { idempotencyKey?: string; meta?: Record<string, unknown> } = {}
  ): Promise<ITransaction> {
    assertWholeAmount(amount);
    if (amount < 0) throw httpError(400, 'Use debit() for negative movements.');

    if (options.idempotencyKey) {
      const existing = await Transaction.findOne({
        userId,
        type,
        'meta.idempotencyKey': options.idempotencyKey,
      });
      if (existing) return existing;
    }

    await walletService.getOrCreateWallet(userId);

    // Atomic guarded credit.
    const updated = await Wallet.findOneAndUpdate(
      { userId },
      { $inc: { availableBalance: amount, totalEarned: amount } },
      { new: true }
    );
    if (!updated) throw httpError(404, 'Wallet not found.');

    return Transaction.create({
      userId,
      type,
      amount,
      balanceAfter: updated.availableBalance,
      description,
      meta: { ...(options.meta ?? {}), ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}) },
    });
  },

  /** Debit with a floor of zero; throws 422 when funds are insufficient. */
  async debit(
    userId: string | Types.ObjectId,
    type: TransactionType,
    amount: number,
    description: string,
    options: { allowNegativeBalance?: boolean; meta?: Record<string, unknown> } = {}
  ): Promise<ITransaction> {
    assertWholeAmount(amount);
    if (amount < 0) throw httpError(400, 'Pass a positive amount to debit().');

    const query: Record<string, unknown> = { userId };
    if (!options.allowNegativeBalance) {
      query.availableBalance = { $gte: amount };
    }

    await walletService.getOrCreateWallet(userId);

    const updated = await Wallet.findOneAndUpdate(
      query,
      { $inc: { availableBalance: -amount } },
      { new: true }
    );
    if (!updated) throw httpError(422, 'Insufficient wallet balance.');

    return Transaction.create({
      userId,
      type,
      amount: -amount,
      balanceAfter: updated.availableBalance,
      description,
      meta: options.meta,
    });
  },

  /** Wallet + recent ledger for the authenticated user. */
  async getOverview(userId: string | Types.ObjectId, limit = 20) {
    const wallet = await walletService.getOrCreateWallet(userId);
    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100));
    return { wallet, transactions };
  },

  /** Sum of ledger amounts by type – used by the dashboard summary. */
  async sumByType(userId: string | Types.ObjectId, type: TransactionType): Promise<number> {
    const result = await Transaction.aggregate<{ total: number | undefined }>([
      { $match: { userId: new Types.ObjectId(userId.toString()), type } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return result[0]?.total ?? 0;
  },
};
