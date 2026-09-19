// src/controllers/vipController.ts
// Thin HTTP controllers for VIP endpoints. Business logic lives in the VIP
// service.

import { Request, Response, NextFunction } from 'express';
import { vipService } from '../services/vipService';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const vipController = {
  async listLevels(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ levels: vipService.listLevels() });
    } catch (err) {
      next(err);
    }
  },

  async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await vipService.getStatus(req.user!.id);
      if (!status) throw httpError(404, 'User not found.');
      res.json({ status });
    } catch (err) {
      next(err);
    }
  },

  async listPurchases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? Number.parseInt(String(req.query.limit), 10) : 20;
      const purchases = await vipService.listPurchases(req.user!.id, Number.isNaN(limit) ? 20 : limit);
      res.json({ purchases });
    } catch (err) {
      next(err);
    }
  },

  async requestUpgrade(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const purchase = await vipService.requestUpgrade(req.user!.id, req.body.levelCode);
      res.status(201).json({ purchase });
    } catch (err) {
      next(err);
    }
  },

  async cancelPending(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await vipService.cancelPending(req.user!.id);
      res.json({ message: 'Pending VIP upgrade cancelled.' });
    } catch (err) {
      next(err);
    }
  },
};
