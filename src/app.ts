// src/app.ts
// Express application configuration.
//
// Wires up security middleware (Helmet, CORS, cookie-parser), body parsing,
// rate limiting, the auth router, and the error-handling stack.

import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { apiLimiter } from './middleware/rateLimiter';
import { notFound } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';
import authRouter from './routes/auth';
import userRouter from './routes/users';
import notificationRouter from './routes/notifications';
import vipRouter from './routes/vip';
import taskRouter from './routes/tasks';
import walletRouter from './routes/wallet';
import adminRouter from './routes/admin';
import paymentsRouter from './routes/payments';

export function createApp(): Express {
  const app = express();

  // --- Trust proxy -------------------------------------------------------
  // Behind a reverse proxy (nginx, load balancer), Express must trust the
  // proxy's `X-Forwarded-*` headers for secure cookies and rate limiting by
  // real client IP. Enable in production; in dev we leave it disabled.
  if (env.isProduction) {
    app.set('trust proxy', 1);
  }

  // --- Security middleware ----------------------------------------------
  app.use(helmet());
  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );
  app.use(express.json({
    limit: '1mb',
    // Preserve the raw body on every JSON request so webhook routes (e.g. the
    // Paystack receiver) can verify HMAC signatures over the exact bytes sent.
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
    },
  }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // --- Health check ------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // --- Rate limiting (global) ------------------------------------------
  app.use('/api', apiLimiter);

  // --- Routes ------------------------------------------------------------
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/vip', vipRouter);
  app.use('/api/tasks', taskRouter);
  app.use('/api/wallet', walletRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/admin', adminRouter);

  // --- 404 + error handler ----------------------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
