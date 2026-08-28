// src/routes/users.ts
// User-facing endpoints (profile, settings, dashboard).
//
// All routes require authentication. The authenticated user is resolved from
// the JWT context (`req.user.id`) – client-supplied IDs are never trusted.

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { validate } from '../validation/auth';
import { updateProfileSchema, updatePreferencesSchema } from '../validation/user';
import { userController } from '../controllers/userController';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.use(apiLimiter);

/**
 * GET /api/users/me
 * Current authenticated user profile.
 */
userRouter.get('/me', userController.getMe);

/**
 * PATCH /api/users/me
 * Update editable profile fields. Privileged fields are stripped by the
 * service layer regardless of what the client sends.
 */
userRouter.patch('/me', validate(updateProfileSchema), userController.updateMe);

/**
 * PATCH /api/users/me/preferences
 * Update notification preferences.
 */
userRouter.patch('/me/preferences', validate(updatePreferencesSchema), userController.updatePreferences);

/**
 * GET /api/users/me/dashboard
 * Aggregated dashboard summary for the current user.
 */
userRouter.get('/me/dashboard', userController.getDashboard);

export default userRouter;
