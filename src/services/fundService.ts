// src/services/fundService.ts
// Fund/Investment service: user-facing catalogue, wallet-backed investing and
// the "My Fund" records. Admin CRUD lives in routes/adminFunds.ts on purpose —
// funds are catalogue data, not a money-moving service beyond the wallet debit.

import { Types } from 'mongoose';
import { Fund, FundStatus, IFund } from '../models/Fund';
import {
  FundInvestment,
  FundInvestmentStatus,
  IFundInvestment,
} from '../models/FundInvestment';
import { TransactionType } from '../models/Transaction';
import { walletService } from './walletService';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** Read status: an ACTIVE investment past its maturity date reads as MATURED. */
function effectiveInvestmentStatus(inv: IFundInvestment): FundInvestmentStatus {
  if (inv.status === FundInvestmentStatus.ACTIVE && inv.maturesAt.getTime() <= Date.now()) {
    return FundInvestmentStatus.MATURED;
  }
  return inv.status;
}

function toFundDTO(fund: IFund) {
  return {
    id: fund._id.toString(),
    name: fund.name,
    category: fund.category,
    amount: fund.amount,
    durationDays: fund.durationDays,
    expectedReturn: fund.expectedReturn,
    description: fund.description ?? '',
    startDate: fund.startDate.toISOString(),
    endDate: fund.endDate.toISOString(),
    status: fund.status,
    createdAt: fund.createdAt.toISOString(),
  };
}

function toInvestmentDTO(inv: IFundInvestment) {
  return {
    id: inv._id.toString(),
    fundId: inv.fundId.toString(),
    fundName: inv.fundName,
    category: inv.category,
    amount: inv.amount,
    expectedReturn: inv.expectedReturn,
    startDate: inv.startDate.toISOString(),
    maturesAt: inv.maturesAt.toISOString(),
    investedAt: inv.createdAt.toISOString(),
    status: effectiveInvestmentStatus(inv),
  };
}

export const fundService = {
  toFundDTO,
  toInvestmentDTO,

  /**
   * User-facing catalogue: every fund except deactivated (INACTIVE) ones.
   * Sold-out and completed funds remain visible so users can see their status.
   */
  async listVisibleFunds(): Promise<IFund[]> {
    return Fund.find({ status: { $ne: FundStatus.INACTIVE } }).sort({ createdAt: -1 });
  },

  /** The user's own fund records, newest first (status computed on read). */
  async myList(userId: string | Types.ObjectId): Promise<IFundInvestment[]> {
    return FundInvestment.find({ userId }).sort({ createdAt: -1 });
  },

  /**
   * Invest in a fund: debits the wallet balance (never the earning balance)
   * and records the investment so both the user and admin can track it.
   */
  async invest(userId: string | Types.ObjectId, fundId: string): Promise<IFundInvestment> {
    const fund = await Fund.findById(fundId);
    if (!fund) throw httpError(404, 'Fund not found.');
    if (fund.status === FundStatus.INACTIVE) throw httpError(404, 'Fund not found.');
    if (fund.status !== FundStatus.ACTIVE) {
      throw httpError(409, `This fund is ${fund.status === FundStatus.SOLD_OUT ? 'sold out' : 'completed'} and no longer accepts investments.`);
    }
    if (fund.endDate.getTime() <= Date.now()) {
      throw httpError(409, 'This fund has passed its end date and no longer accepts investments.');
    }

    // Wallet debit — throws 422 when the balance is insufficient. Investments
    // only move availableBalance, so Total Earning Balance is unaffected.
    await walletService.debit(
      userId,
      TransactionType.FUND_INVESTMENT,
      fund.amount,
      `Invested in ${fund.name}`,
      { meta: { fundId: fund._id.toString() } }
    );

    return FundInvestment.create({
      userId,
      fundId: fund._id,
      fundName: fund.name,
      category: fund.category,
      amount: fund.amount,
      expectedReturn: fund.expectedReturn,
      startDate: fund.startDate,
      maturesAt: fund.endDate,
      status: FundInvestmentStatus.ACTIVE,
    });
  },
};
