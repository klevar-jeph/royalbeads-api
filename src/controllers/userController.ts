// src/controllers/userController.ts
// Thin HTTP controllers for user-facing endpoints. Business logic lives in
// the user/dashboard services.

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { User } from '../models/User';
import { userService } from '../services/userService';
import { dashboardService } from '../services/dashboardService';
import { sendPasswordResetEmail } from '../services/email';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const userController = {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await userService.getCurrentUser(req.user!.id);
      if (!user) throw httpError(404, 'User not found.');
      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await userService.updateProfile(req.user!.id, req.body);
      if (!user) throw httpError(404, 'User not found.');
      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

  async updatePreferences(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await userService.updatePreferences(req.user!.id, req.body);
      if (!user) throw httpError(404, 'User not found.');
      res.json({ user });
    } catch (err) {
      next(err);
    }
  },

    async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const summary = await dashboardService.getDashboardSummary(req.user!.id);
      if (!summary) throw httpError(404, 'User not found.');
      res.json({ summary });
    } catch (err) {
      next(err);
    }
  },

  /** POST /api/users/me/password/forgot — generate reset token + email it. */
  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      // Only allow requesting a reset for the user's OWN email address.
      const me = await User.findById(req.user!.id);
      if (!me) throw httpError(404, 'User not found.');
      if (me.email !== email) throw httpError(403, 'You can only reset your own password.');

      me.passwordResetToken = crypto.randomBytes(32).toString('hex');
      me.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await me.save();
      await sendPasswordResetEmail(me.email, me.passwordResetToken!);

      res.json({ message: 'If the account exists, a reset link has been sent.' });
    } catch (err) {
      next(err);
    }
  },

  /** POST /api/users/me/password/reset — consume token + set new password. */
  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = req.body;
      const user = await User.findOne({
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() },
      });
      if (!user) throw httpError(400, 'Invalid or expired reset token.');

      await user.setPassword(password);
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save();

      res.json({ message: 'Password reset successful. Please log in again.' });
    } catch (err) {
      next(err);
    }
  },

  /** POST /api/users/me/password/change — change password (current required). */
  async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user!.id);
      if (!user) throw httpError(404, 'User not found.');

      const match = await user.comparePassword(currentPassword);
      if (!match) throw httpError(401, 'Current password is incorrect.');

      await user.setPassword(newPassword);
      await user.save();

      res.json({ message: 'Password changed.' });
    } catch (err) {
      next(err);
    }
  },
};
