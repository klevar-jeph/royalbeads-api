// src/routes/payments.ts
// Gateway payment routes: Paystack initialize + webhook.
//
// Initialize requires authentication (per-user deposit). Webhooks are public
// by necessity and are authenticated via the HMAC signature + server-side
// re-verification before any wallet movement happens.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { validate } from '../validation/auth';
import { depositSchema } from '../validation/wallet';
import { paystackService } from '../services/paystackService';
import { paymentService } from '../services/paymentService';
import { Deposit, DepositStatus } from '../models/Deposit';
import { User } from '../models/User';

export const paymentsRouter = Router();

paymentsRouter.use(apiLimiter);

/**
 * POST /api/payments/paystack/initialize
 * Start a Paystack collection. Delegates to paymentService.createDeposit
 * which, when PAYMENT_PROVIDER=paystack, calls Paystack's /transaction/
 * initialize API and returns the authorization URL for the browser to
 * redirect to. Body: { amount, note? }.
 */
paymentsRouter.post(
  '/paystack/initialize',
  requireAuth,
  validate(depositSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await User.findById(req.user!.id);
      if (!user) return res.status(404).json({ message: 'User not found.' });

      const result = await paymentService.createDeposit(
        user._id,
        req.body.amount,
        req.body.note,
        user.email
      );

      res.status(201).json({
        deposit: {
          id: result._id.toString(),
          amount: result.amount,
          reference: result.reference,
          status: result.status,
        },
        authorizationUrl: (result as unknown as { authorizationUrl?: string }).authorizationUrl,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payments/webhook/paystack
 * Paystack webhook receiver. The JSON parser must preserve the RAW body for
 * signature verification – `app.ts` is configured with a `verify` hook that
 * stores it on `req.rawBody` for this route.
 */
paymentsRouter.post(
  '/webhook/paystack',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawBody: Buffer | string | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
      const signature = req.headers['x-paystack-signature'] as string | undefined;

      const bodyText =
        rawBody !== undefined ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
      if (!paystackService.verifyWebhookSignature(bodyText, signature)) {
        return res.status(401).json({ message: 'Invalid webhook signature.' });
      }

      const { event, data } = req.body as { event?: string; data?: { reference?: string } };
      if (event !== 'charge.success' || !data?.reference) {
        return res.json({ received: true, ignored: true });
      }

      // Already processed? Skip silently (idempotent).
      const deposit = await Deposit.findOne({ reference: data.reference });
      if (!deposit) return res.json({ received: true, ignored: true });
      if (deposit.status !== DepositStatus.PENDING) {
        return res.json({ received: true, ignored: true });
      }

      // Server-side re-verification: reference + amount must match.
      let verification;
      try {
        verification = await paystackService.verify(data.reference);
      } catch {
        return res.json({ received: true, verified: false });
      }
      if (verification.status !== 'success' || verification.amountKobo !== deposit.amount * 100) {
        return res.json({ received: true, verified: false });
      }

      // Idempotently credit the wallet via the confirmation path.
      const systemReviewer = deposit.userId; // confirmed "by system" paper trail
      await paymentService.confirmDeposit(
        deposit._id,
        systemReviewer,
        'APPROVE',
        'Paystack webhook: charge.success verified.'
      );

      res.json({ received: true, credited: true });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payments/paystack/verify/:reference
 * Client polling fallback after Paystack redirects back: server-side verify,
 * then credit if the deposit is still PENDING and amounts match.
 */
paymentsRouter.get(
  '/paystack/verify/:reference',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deposit = await Deposit.findOne({ reference: req.params.reference, userId: req.user!.id });
      if (!deposit) return res.status(404).json({ message: 'Deposit not found.' });

      if (deposit.status !== DepositStatus.PENDING) {
        return res.json({ deposit: { reference: deposit.reference, status: deposit.status } });
      }

      const verification = await paystackService.verify(deposit.reference);
      if (verification.status !== 'success' || verification.amountKobo !== deposit.amount * 100) {
        return res.json({ deposit: { reference: deposit.reference, status: deposit.status, verified: false } });
      }

      await paymentService.confirmDeposit(
        deposit._id,
        req.user!.id,
        'APPROVE',
        'Paystack verify: client-callback confirmation.'
      );
      res.json({ deposit: { reference: deposit.reference, status: 'APPROVED', verified: true } });
    } catch (err) {
      next(err);
    }
  }
);

export default paymentsRouter;
