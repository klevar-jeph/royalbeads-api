// src/services/levelService.ts
// Level management service: querying, level hierarchy, status, capacity, and temporary openings.

import { LevelConfig, LevelStatus, ILevelConfig } from '../models/LevelConfig';
import { bootstrapService } from './bootstrapService';

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

export const levelService = {
  /** Get all levels sorted by rank */
  async listLevels(): Promise<ILevelConfig[]> {
    await bootstrapService.bootstrapLevels();
    return LevelConfig.find({}).sort({ rank: 1 });
  },

  /** Get a level by code */
  async getByCode(code: string): Promise<ILevelConfig | null> {
    await bootstrapService.bootstrapLevels();
    return LevelConfig.findOne({ code: code.toUpperCase() });
  },

  /** Get a level by rank/tier */
  async getByRank(rank: number): Promise<ILevelConfig | null> {
    await bootstrapService.bootstrapLevels();
    return LevelConfig.findOne({ rank });
  },

  /** Check if a level is open / active (accounting for temporary openings) */
  isLevelAccessible(level: ILevelConfig): boolean {
    if (level.status === LevelStatus.OPEN) return true;
    if (level.temporaryOpen) {
      const now = new Date();
      if (
        (!level.temporaryOpenStart || now >= level.temporaryOpenStart) &&
        (!level.temporaryOpenEnd || now <= level.temporaryOpenEnd)
      ) {
        return true;
      }
    }
    return false;
  },

  /** Admin update a level configuration */
  async updateLevel(
    code: string,
    patch: Partial<{
      name: string;
      status: LevelStatus;
      tasksPerDay: number;
      rewardPerTask: number;
      dailyEarning: number;
      investment: number;
      description: string;
      temporaryOpen: boolean;
      temporaryOpenStart: Date | null;
      temporaryOpenEnd: Date | null;
      minDirectReferrals: number;
      minTotalTeam: number;
    }>
  ): Promise<ILevelConfig> {
    const level = await LevelConfig.findOne({ code: code.toUpperCase() });
    if (!level) throw httpError(404, `Level ${code} not found.`);

    if (patch.name !== undefined) level.name = patch.name;
    if (patch.status !== undefined) level.status = patch.status;
    if (patch.tasksPerDay !== undefined) level.tasksPerDay = patch.tasksPerDay;
    if (patch.rewardPerTask !== undefined) level.rewardPerTask = patch.rewardPerTask;
    if (patch.dailyEarning !== undefined) {
      level.dailyEarning = patch.dailyEarning;
    } else if (patch.tasksPerDay !== undefined || patch.rewardPerTask !== undefined) {
      level.dailyEarning = level.tasksPerDay * level.rewardPerTask;
    }
    if (patch.investment !== undefined) level.investment = patch.investment;
    if (patch.description !== undefined) level.description = patch.description;
    if (patch.temporaryOpen !== undefined) level.temporaryOpen = patch.temporaryOpen;
    if (patch.temporaryOpenStart !== undefined) level.temporaryOpenStart = patch.temporaryOpenStart ?? undefined;
    if (patch.temporaryOpenEnd !== undefined) level.temporaryOpenEnd = patch.temporaryOpenEnd ?? undefined;
    if (patch.minDirectReferrals !== undefined) level.minDirectReferrals = patch.minDirectReferrals;
    if (patch.minTotalTeam !== undefined) level.minTotalTeam = patch.minTotalTeam;

    await level.save();
    return level;
  },
};
