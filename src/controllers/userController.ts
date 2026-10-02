// src/controllers/userController.ts
// Thin HTTP controllers for user-facing endpoints. Business logic lives in
// the user/dashboard services.

import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { userService } from '../services/userService';
import { dashboardService } from '../services/dashboardService';

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

  /**
   * POST /api/users/me/security-password
   * Set (first time) or change the secondary security password. The login
   * password always proves ownership; the new value is hashed by the model's
   * pre('save') hook.
   */
  async setSecurityPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { currentPassword, securityPassword } = req.body;
      const user = await User.findById(req.user!.id);
      if (!user) throw httpError(404, 'User not found.');

      const match = await user.comparePassword(currentPassword);
      if (!match) throw httpError(401, 'Current password is incorrect.');

      user.securityPasswordHash = securityPassword;
      await user.save();

      res.json({ message: 'Security password updated.' });
    } catch (err) {
      next(err);
    }
  },
};
