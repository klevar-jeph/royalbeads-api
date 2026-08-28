// src/services/email/index.ts
// Email service.
//
// Two providers are supported:
//   - "console" (default for dev): logs the rendered email to stdout.
//   - "smtp": uses nodemailer with the SMTP settings from env vars.
//
// The public API is intentionally tiny – `sendEmail` and a handful of typed
// helpers for the common auth flows. Templates are plain strings so that a
// future migration to a templating engine does not change call sites.

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

export function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Verify your Royalbeads account',
    text: `Welcome to Royalbeads!\n\nPlease verify your email by visiting the following link:\n${verifyUrl}\n\nThis link expires in 24 hours.\n\nIf you did not create an account, you can ignore this email.`,
  });
}

export function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to,
    subject: 'Reset your Royalbeads password',
    text: `You requested a password reset.\n\nReset your password here:\n${resetUrl}\n\nThis link expires in 1 hour.\n\nIf you did not request a reset, you can safely ignore this email.`,
  });
}
