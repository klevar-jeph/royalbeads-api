// src/routes/funds.ts
// Mine → Fund: catalogue, the user's own records and investing.
// Kept separate from the task/reward routers — funds are an additional
// opportunity within the platform, not part of the task economy.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { fundService } from '../services/fundService';

export const fundsRouter = Router();

fundsRouter.use(requireAuth);
fundsRouter.use(apiLimiter);

/**
 * GET /api/funds
 * The visible fund catalogue (short/medium/long term), status included.
 */
fundsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const funds = await fundService.listVisibleFunds();
    res.json({ funds: funds.map(fundService.toFundDTO) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/funds/mine
 * The user's own investment records ("My Fund").
 */
fundsRouter.get('/mine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const investments = await fundService.myList(req.user!.id);
    res.json({ investments: investments.map(fundService.toInvestmentDTO) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/funds/:id/invest
 * Invest the fund's amount from the user's wallet balance.
 */
fundsRouter.post('/:id/invest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const investment = await fundService.invest(req.user!.id, req.params.id);
    res.status(201).json({ investment: fundService.toInvestmentDTO(investment) });
  } catch (err) {
    next(err);
  }
});

export default fundsRouter;