// src/middleware/errorHandler.ts
// Centralised error-handling middleware.
//
// Express identifies error handlers by their 4-argument signature.
// This must be registered AFTER all routes and the not-found handler.

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';

interface HttpError extends Error {
  status?: number;
  code?: number;
  details?: unknown;
}

/**
 * Normalise an unknown error into a status + message.
 */
function normaliseError(err: HttpError): { status: number; message: string; details?: unknown } {
  // Zod validation errors.
  if (err instanceof ZodError) {
    return {
      status: 422,
      message: 'Validation failed.',
      details: err.flatten(),
    };
  }

  // Mongoose duplicate key (E11000).
  if (err.code === 11000) {
    return { status: 409, message: 'A resource with that value already exists.' };
  }

  // Mongoose validation error.
  if (err.name === 'ValidationError') {
    return { status: 422, message: 'Validation failed.', details: (err as any).errors };
  }

  // Mongoose cast / not found.
  if (err.name === 'CastError') {
    return { status: 400, message: 'Invalid identifier.' };
  }

  if (err.status) {
    return { status: err.status, message: err.message };
  }

  return { status: 500, message: 'Internal server error.' };
}

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const { status, message, details } = normaliseError(err);

  const body: Record<string, unknown> = { error: status >= 500 ? 'ServerError' : 'Error', message };
  if (details !== undefined) body.details = details;

  // Never leak stack traces in production.
  if (status >= 500 && !env.isProduction) {
    body.stack = err.stack;
  }

  if (status >= 500) {
    console.error('[errorHandler]', err);
  }

  res.status(status).json(body);
}
