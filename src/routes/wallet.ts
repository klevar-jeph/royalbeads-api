// src/routes/wallet.ts
// Wallet endpoints for the authenticated user.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { validate } from '../validation/auth';
import { depositSchema, withdrawalSchema } from '../validation/wallet';
import { walletController } from '../controllers/walletController';

export const walletRouter = Router();

walletRouter.use(requireAuth);
walletRouter.use(apiLimiter);

/**
 * GET /api/wallet
 * The user's wallet overview (balances + recent ledger).
 */
walletRouter.get('/', walletController.getOverview);

/**
 * GET /api/wallet/transactions?type=&limit=
 * The user's transaction ledger, optionally filtered by type.
 */
walletRouter.get('/transactions', walletController.getTransactions);

/**
 * GET /api/wallet/instructions
 * Payment instructions for the active provider (bank details when manual).
 */
walletRouter.get('/instructions', walletController.getInstructions);

/**
 * POST /api/wallet/deposits — submit a deposit request.
 * GET  /api/wallet/deposits?status= — the user's deposit history.
 */
walletRouter.post('/deposits', validate(depositSchema), walletController.createDeposit);
walletRouter.get('/deposits', walletController.listDeposits);

/**
 * POST /api/wallet/withdrawals — submit a withdrawal request.
 * GET  /api/wallet/withdrawals?status= — the user's withdrawal history.
 */
walletRouter.post('/withdrawals', validate(withdrawalSchema), walletController.createWithdrawal);
walletRouter.get('/withdrawals', walletController.listWithdrawals);

export default walletRouter;
