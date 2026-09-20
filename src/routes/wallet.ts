// src/routes/wallet.ts
// Wallet endpoints for the authenticated user.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { walletController } from '../controllers/walletController';

export const walletRouter = Router();

walletRouter.use(requireAuth);
walletRouter.use(apiLimiter);

/**
 * GET /api/wallet
 * The user's wallet overview (balances + ledger).
 */
walletRouter.get('/', walletController.getOverview);

export default walletRouter;
