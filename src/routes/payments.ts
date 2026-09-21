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

/** Lazily read the callback URL so runtime-set env also applies. */
function callbackUrl(): string | undefined {
  return process.env.PAYSTACK_CALLBACK_URL || undefined;
}

export const paymentsRouter = Router();

paymentsRouter.use(apiLimiter);

/**
 * POST /api/payments/paystack/initialize
 * Start a Paystack collection: creates a PENDING local deposit and returns the
 * authorization URL. Body: { amount, note? }.
 */
paymentsRouter.post(
  '/paystack/initialize',
  requireAuth,
  validate(depositSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await User.findById(req.user!.id);
      if (!user) return res.status(404).json({ message: 'User not found.' });

      // Create the local PENDING deposit first (method GATEWAY forced below).
      const deposit = await Deposit.create({
        userId: user._id,
        amount: req.body.amount,
        note: req.body.note,
        method: 'GATEWAY',
        status: DepositStatus.PENDING,
        reference: `PSK-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 8)
          .toUpperCase()}`,
      });

      const checkout = await paystackService.initialize(
        user.email,
        req.body.amount,
        deposit.reference,
        callbackUrl()
      );

      res.status(201).json({
        deposit: {
          id: deposit._id.toString(),
          amount: deposit.amount,
          reference: deposit.reference,
          status: deposit.status,
        },
        authorizationUrl: checkout.authorizationUrl,
        accessCode: checkout.accessCode,
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

      // Idempotently credit the wallet via the existing review path.
      const systemReviewer = deposit.userId; // reviewed "by system" paper trail
      await paymentService.reviewDeposit(
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

      await paymentService.reviewDeposit(
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
