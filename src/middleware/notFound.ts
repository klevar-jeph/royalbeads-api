// src/middleware/notFound.ts
// 404 handler – catches unmatched routes.

import { Request, Response } from 'express';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'NotFound', message: 'The requested resource was not found.' });
}
