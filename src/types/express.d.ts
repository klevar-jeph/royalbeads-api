// src/types/express.d.ts
// Augment Express Request with authenticated user payload.

import 'express';

export interface AuthenticatedUser {
  id: string;
  role: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
