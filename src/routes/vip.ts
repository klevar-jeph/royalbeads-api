// src/routes/vip.ts
// VIP endpoints (levels, current status, upgrade requests).
//
// `GET /api/vip/levels` is public (the marketing site surfaces the same data);
// everything else requires authentication.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { UserRole } from '../models/User';
import { apiLimiter } from '../middleware/rateLimiter';
import { validate } from '../validation/auth';
import { upgradeRequestSchema } from '../validation/vip';
import { vipController } from '../controllers/vipController';
import { vipService } from '../services/vipService';

export const vipRouter = Router();

/**
 * GET /api/vip/levels
 * Public catalogue of VIP levels.
 */
vipRouter.get('/levels', vipController.listLevels);

vipRouter.use(requireAuth);
vipRouter.use(apiLimiter);

/**
 * GET /api/vip/me
 * Current user's VIP status (level, next level, pending purchase).
 */
vipRouter.get('/me', vipController.getStatus);

/**
 * GET /api/vip/me/purchases
 * The user's VIP purchase history.
 */
vipRouter.get('/me/purchases', vipController.listPurchases);

/**
 * POST /api/vip/purchase
 * Request an upgrade to a higher level (creates a PENDING purchase).
 */
vipRouter.post('/purchase', validate(upgradeRequestSchema), vipController.requestUpgrade);

/**
 * DELETE /api/vip/purchase
 * Cancel the user's own pending upgrade request.
 */
vipRouter.delete('/purchase', vipController.cancelPending);

// --- Admin -----------------------------------------------------------------
// Purchase review (payment confirmation) – administrators only. The full
// admin console is built in the admin phase; this endpoint is the mechanism
// through which pending purchases are activated.

/**
 * POST /api/vip/admin/purchases/:id/review
 * Approve or reject a pending VIP purchase.
 */
vipRouter.post(
  '/admin/purchases/:id/review',
  requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN),
  async (req, res, next) => {
    try {
      const purchase = await vipService.reviewPurchase(
        req.params.id,
        req.user!.id,
        req.body.decision,
        req.body.note
      );
      res.json({ purchase });
    } catch (err) {
      next(err);
    }
  }
);

export default vipRouter;
