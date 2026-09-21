// src/services/paymentService.ts
// Deposits & withdrawals.
//
// Deposits (manual/bank-transfer provider): the user submits a PENDING
// request; an admin confirms payment and the wallet is credited atomically.
// Withdrawals: the user submits bank details; approval debits the wallet
// immediately (guarded, so an overdraft is impossible) and marks the request
// APPROVED; an admin later flips it to PAID after the transfer settles.

import { Deposit, DepositStatus, IDeposit } from '../models/Deposit';
import { Withdrawal, WithdrawalStatus, IWithdrawal } from '../models/Withdrawal';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';
import { referralService } from './referralService';
import { Notification, NotificationType } from '../models/Notification';
import { env } from '../config/env';
import { Types } from 'mongoose';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function newReference(prefix: string): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

export const paymentService = {
  /** Public payment instructions for the current provider (no secrets). */
  getInstructions() {
    const provider = env.payments.provider;
    return {
      provider,
      bankTransfer:
        provider === 'manual'
          ? {
              bankName: env.payments.bankName,
              accountName: env.payments.bankAccountName,
              accountNumber: env.payments.bankAccountNumber,
            }
          : undefined,
      minWithdrawal: env.minWithdrawal,
    };
  },

  // --- Deposits ------------------------------------------------------------

  async createDeposit(
    userId: string | Types.ObjectId,
    amount: number,
    note?: string
  ): Promise<IDeposit> {
    const deposit = await Deposit.create({
      userId,
      amount,
      note,
      method: env.payments.provider === 'manual' ? 'BANK_TRANSFER' : 'GATEWAY',
      status: DepositStatus.PENDING,
      reference: newReference('DEP'),
    });

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Deposit submitted',
      message: `Your deposit request of ₦${amount.toLocaleString()} (ref ${deposit.reference}) is awaiting confirmation.`,
    });

    return deposit;
  },

  async listDeposits(
    userId: string | Types.ObjectId,
    options: { status?: DepositStatus; limit?: number } = {}
  ): Promise<IDeposit[]> {
    const query: Record<string, unknown> = { userId };
    if (options.status) query.status = options.status;
    return Deposit.find(query).sort({ createdAt: -1 }).limit(Math.min(options.limit ?? 20, 100));
  },

  async reviewDeposit(
    depositId: string | Types.ObjectId,
    reviewerId: string | Types.ObjectId,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ): Promise<IDeposit> {
    const deposit = await Deposit.findById(depositId);
    if (!deposit) throw httpError(404, 'Deposit not found.');
    if (deposit.status !== DepositStatus.PENDING) {
      throw httpError(409, 'This deposit has already been reviewed.');
    }

    deposit.status = decision === 'APPROVE' ? DepositStatus.APPROVED : DepositStatus.REJECTED;
    deposit.reviewedBy = new Types.ObjectId(reviewerId.toString());
    deposit.reviewNote = note;
    deposit.reviewedAt = new Date();
    await deposit.save();

    if (decision === 'APPROVE') {
      await walletService.credit(
        deposit.userId,
        TransactionType.DEPOSIT,
        deposit.amount,
        `Deposit confirmed (${deposit.reference})`,
        { idempotencyKey: `deposit:${deposit._id}`, meta: { depositId: deposit._id.toString() } }
      );

      // Referral programme: credit the referrer (idempotent per deposit).
      try {
        await referralService.creditReferralCommission(deposit.userId, deposit._id, deposit.amount);
      } catch (err) {
        // A referral failure must never block the user's deposit confirmation.
        console.error('[paymentService] referral commission failed:', err);
      }
    }

    await Notification.create({
      userId: deposit.userId,
      type: NotificationType.WALLET,
      title: decision === 'APPROVE' ? 'Deposit confirmed' : 'Deposit rejected',
      message:
        decision === 'APPROVE'
          ? `Your deposit of ₦${deposit.amount.toLocaleString()} has been credited to your wallet.`
          : note
            ? `Your deposit (ref ${deposit.reference}) was rejected: ${note}`
            : `Your deposit (ref ${deposit.reference}) was rejected.`,
    });

    return deposit;
  },

  // --- Withdrawals ---------------------------------------------------------

  async createWithdrawal(
    userId: string | Types.ObjectId,
    input: { amount: number; bankName: string; accountNumber: string; accountName: string }
  ): Promise<IWithdrawal> {
    if (input.amount < env.minWithdrawal) {
      throw httpError(400, `Minimum withdrawal is ₦${env.minWithdrawal.toLocaleString()}.`);
    }

    const wallet = await walletService.getOrCreateWallet(userId);
    if (wallet.availableBalance < input.amount) {
      throw httpError(422, 'Insufficient wallet balance.');
    }

    const withdrawal = await Withdrawal.create({
      userId,
      amount: input.amount,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountName: input.accountName,
      status: WithdrawalStatus.PENDING,
      reference: newReference('WDR'),
    });

    await Notification.create({
      userId,
      type: NotificationType.WALLET,
      title: 'Withdrawal submitted',
      message: `Your withdrawal request of ₦${input.amount.toLocaleString()} (ref ${withdrawal.reference}) is awaiting approval.`,
    });

    return withdrawal;
  },

  async listWithdrawals(
    userId: string | Types.ObjectId,
    options: { status?: WithdrawalStatus; limit?: number } = {}
  ): Promise<IWithdrawal[]> {
    const query: Record<string, unknown> = { userId };
    if (options.status) query.status = options.status;
    return Withdrawal.find(query).sort({ createdAt: -1 }).limit(Math.min(options.limit ?? 20, 100));
  },

  /**
   * Admin approval. The wallet is debited at approval time (guarded, so a
   * stale balance can never overdraw); rejection needs no balance change.
   */
  async reviewWithdrawal(
    withdrawalId: string | Types.ObjectId,
    reviewerId: string | Types.ObjectId,
    decision: 'APPROVE' | 'REJECT',
    note?: string
  ): Promise<IWithdrawal> {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw httpError(404, 'Withdrawal not found.');
    if (withdrawal.status !== WithdrawalStatus.PENDING) {
      throw httpError(409, 'This withdrawal has already been reviewed.');
    }

    if (decision === 'REJECT') {
      withdrawal.status = WithdrawalStatus.REJECTED;
      withdrawal.reviewedBy = new Types.ObjectId(reviewerId.toString());
      withdrawal.reviewNote = note;
      withdrawal.reviewedAt = new Date();
      await withdrawal.save();
      await Notification.create({
        userId: withdrawal.userId,
        type: NotificationType.WALLET,
        title: 'Withdrawal rejected',
        message: note
          ? `Your withdrawal (ref ${withdrawal.reference}) was rejected: ${note}`
          : `Your withdrawal (ref ${withdrawal.reference}) was rejected.`,
      });
      return withdrawal;
    }

    // Debit at approval; walletService guards against overdraft.
    try {
      await walletService.debit(
        withdrawal.userId,
        TransactionType.WITHDRAWAL,
        withdrawal.amount,
        `Withdrawal approved (${withdrawal.reference})`,
        { meta: { withdrawalId: withdrawal._id.toString() } }
      );
    } catch (err) {
      if ((err as { status?: number }).status === 422) {
        throw httpError(422, 'User no longer has sufficient balance for this withdrawal.');
      }
      throw err;
    }

    withdrawal.status = WithdrawalStatus.APPROVED;
    withdrawal.reviewedBy = new Types.ObjectId(reviewerId.toString());
    withdrawal.reviewNote = note;
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();

    await Notification.create({
      userId: withdrawal.userId,
      type: NotificationType.WALLET,
      title: 'Withdrawal approved',
      message: `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been approved and will be transferred to ${withdrawal.bankName}.`,
    });

    return withdrawal;
  },

  /** Mark an approved withdrawal as PAID once the external transfer settles. */
  async markPaid(
    withdrawalId: string | Types.ObjectId,
    reviewerId: string | Types.ObjectId
  ): Promise<IWithdrawal> {
    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) throw httpError(404, 'Withdrawal not found.');
    if (withdrawal.status !== WithdrawalStatus.APPROVED) {
      throw httpError(409, 'Only approved withdrawals can be marked paid.');
    }
    withdrawal.status = WithdrawalStatus.PAID;
    withdrawal.paidAt = new Date();
    withdrawal.reviewedBy = new Types.ObjectId(reviewerId.toString());
    await withdrawal.save();
    await Notification.create({
      userId: withdrawal.userId,
      type: NotificationType.WALLET,
      title: 'Withdrawal paid',
      message: `₦${withdrawal.amount.toLocaleString()} has been transferred to your ${withdrawal.bankName} account.`,
    });
    return withdrawal;
  },
};
