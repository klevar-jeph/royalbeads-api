// src/routes/team.ts
// Mine → Team: team overview, earnings, friend details and invitation links.

import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { teamCommissionService } from '../services/teamCommissionService';
import { User } from '../models/User';
import { LevelConfig } from '../models/LevelConfig';

export const teamRouter = Router();

teamRouter.use(requireAuth);
teamRouter.use(apiLimiter);

/**
 * GET /api/team
 * Total team earning, today's earning, A/B/C overview and friend details.
 * If the user has not earned any team commission yet, `todayTeamEarnings` is
 * returned as null so the UI can omit the figure instead of showing ₦0.
 */
teamRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await teamCommissionService.getTeamSummary(req.user!.id);
    if (!summary) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }

    const { todayTeamEarnings, totalTeamEarnings, ...rest } = summary;
    res.json({
      team: {
        ...rest,
        totalTeamEarnings,
        todayTeamEarnings: todayTeamEarnings > 0 ? todayTeamEarnings : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/team/members
 * The A/B/C friends list with each member's current position.
 */
teamRouter.get('/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await teamCommissionService.getTeamSummary(req.user!.id);
    if (!summary) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }
    res.json({ members: summary.friends });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/team/invitation
 * Invitation code, link and share text.
 */
teamRouter.get('/invitation', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await User.findById(req.user!.id).select('referralCode fullName');
    if (!user) {
      res.status(404).json({ message: 'User not found.' });
      return;
    }
    const siteUrl = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const link = `${siteUrl}/register?ref=${user.referralCode}`;
    res.json({
      invitationCode: user.referralCode,
      invitationLink: link,
      shareText: `Join Royalbeads with my invitation code ${user.referralCode}: ${link}`,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/team/positions
 * The current position (Intern → Master) of the user and their direct team.
 */
teamRouter.get('/positions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const levels = await LevelConfig.find({}).select('rank code name');
    const myLevel = await User.findById(req.user!.id).select('vipLevel');

    const summary = await teamCommissionService.getTeamSummary(req.user!.id);
    const memberIds = (summary?.friends ?? []).map((f) => f.id);

    const members = await User.find({ _id: { $in: memberIds } }).select('fullName vipLevel');
    const byId = new Map(members.map((m) => [m._id.toString(), m.vipLevel ?? 0]));
    const rankToName = new Map(levels.map((l) => [l.rank, l.name]));

    res.json({
      myPosition: rankToName.get(myLevel?.vipLevel ?? 0) ?? 'Intern',
      members: (summary?.friends ?? []).map((f) => ({
        ...f,
        currentPosition: rankToName.get(byId.get(f.id) ?? 0) ?? 'Intern',
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default teamRouter;
