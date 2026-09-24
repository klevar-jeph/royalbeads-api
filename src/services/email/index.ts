// src/services/email/index.ts
// Email service.
//
// Two providers are supported:
//   - "console" (default for dev): logs the rendered email to stdout.
//   - "smtp": uses nodemailer with the SMTP settings from env vars.
//
// The public API is intentionally tiny – `sendEmail` plus notification copy
// built at call sites. Templates are plain strings so that a future migration
// to a templating engine does not change call sites.

import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (env.email.provider !== 'smtp') {
    throw new Error('SMTP transport is not configured. Set EMAIL_PROVIDER=smtp.');
  }
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: Number(process.env.EMAIL_SMTP_PORT ?? 587),
    secure: process.env.EMAIL_SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_SMTP_USER,
      pass: process.env.EMAIL_SMTP_PASS,
    },
  });
  return transporter;
}

/**
 * Send an email. In development (EMAIL_PROVIDER=console) the message is
 * pretty-printed to stdout instead of being delivered.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.email.provider === 'console') {
    console.log(
      [
        '────────────────── ✉  EMAIL (console provider) ──────────────────',
        `From:    ${env.email.from}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '─────────────────────── text ───────────────────────',
        message.text,
        '─────────────────────────────────────────────────────',
      ].join('\n')
    );
    return;
  }

  await getTransporter().sendMail({
    from: env.email.from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

// --- Typed helpers for auth flows -----------------------------------------
//
// NOTE: the self-service forgot/reset password flow was removed by design.
// A signed-in user changes their password via POST /users/me/password/change
// (current password required); admins reset passwords via the admin console.
