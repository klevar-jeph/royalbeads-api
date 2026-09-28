// src/server.ts
// Application entry point.
//
// Loads environment variables (via `dotenv` when available), connects to
// MongoDB, and starts the HTTP server.

// ⚠️  dotenv MUST be configured synchronously BEFORE any other local imports
// that read process.env (e.g. src/config/env.ts). Dynamic `await import()`
// runs too late because static imports are hoisted and evaluated first.
import 'dotenv/config';

import { createApp } from './app';
import { connectDB } from './config/database';
import { env } from './config/env';
import { ensureAdminAccount } from './services/adminBootstrap';
import { bootstrapService } from './services/bootstrapService';
import { schedulerService } from './services/schedulerService';

async function bootstrap(): Promise<void> {
  await connectDB();

  // Admin account bootstrap (idempotent; env-driven). Never fatal.
  try {
    await ensureAdminAccount();
  } catch (err) {
    console.warn('[admin] Bootstrap skipped:', err instanceof Error ? err.message : err);
  }

  // Seed levels, salary positions, system settings and Lucky Draw prizes.
  // Idempotent: existing configuration and data are never overwritten.
  try {
    await bootstrapService.bootstrapAll();
  } catch (err) {
    console.warn('[bootstrap] Seed skipped:', err instanceof Error ? err.message : err);
  }

  // Server-side automation (month-end salary, weekly retention, event expiry).
  const stopScheduler = schedulerService.start();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Royalbeads API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Graceful shutdown.
  const shutdown = (signal: string) => {
    console.log(`\n${signal} received – shutting down...`);
    stopScheduler();
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force-exit if the server doesn't close within 10s.
    setTimeout(() => {
      console.error('Forcing exit after timeout.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
