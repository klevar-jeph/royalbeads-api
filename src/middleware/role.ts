// src/middleware/role.ts
// Role-based access control middleware.
//
// Usage:
//   router.get('/admin', requireAuth, requireRole(UserRole.ADMIN), handler);
//
// `requireRole` accepts one or more roles; the caller must have one of them.
// `requireSelfOrRole` allows access when the requesting user is the resource
// owner OR holds one of the elevated roles.

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../models/User';

function sendForbidden(res: Response, message: string): void {
  res.status(403).json({ error: 'Forbidden', message });
}

/**
 * Restrict a route to one or more roles. Must be used after `requireAuth`.
 */
export function requireRole(...allowed: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendForbidden(res, 'Authentication required.');
      return;
    }
    const userRole = req.user.role as UserRole;
    if (!allowed.includes(userRole)) {
      sendForbidden(res, 'Insufficient permissions.');
      return;
    }
    next();
  };
}

/**
 * Allow access if the requesting user owns the resource (identified by the
 * route param `id`) OR holds one of the elevated roles.
 */
export function requireSelfOrRole(paramName: string, ...elevated: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendForbidden(res, 'Authentication required.');
      return;
    }
    const resourceOwner = req.params[paramName];
    const userRole = req.user.role as UserRole;

    if (req.user.id === resourceOwner || elevated.includes(userRole)) {
      next();
      return;
    }
    sendForbidden(res, 'Insufficient permissions.');
  };
}

/**
 * Convenience presets.
 */
export const requireAdmin = requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN);
export const requireSuperAdmin = requireRole(UserRole.SUPER_ADMIN);
export const requireSupport = requireRole(UserRole.SUPPORT, UserRole.ADMIN, UserRole.SUPER_ADMIN);
