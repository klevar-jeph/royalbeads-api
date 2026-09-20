// src/models/Wallet.ts
// Per-user wallet. Balances are stored in kobo-free whole Naira integers.
//
// All balance mutations MUST go through the wallet service, which keeps the
// wallet and the transaction ledger consistent. Never `$set` a balance
// directly from route handlers.

import { Schema, model, Document, Types } from 'mongoose';

export interface IWallet extends Document {
  userId: Types.ObjectId;
  /** Spendable balance (whole Naira). */
  availableBalance: number;
  /** Lifetime credited earnings (whole Naira). */
  totalEarned: number;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema<IWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    availableBalance: { type: Number, default: 0, min: 0 },
    totalEarned: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const Wallet = model<IWallet>('Wallet', WalletSchema);
