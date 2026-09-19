// src/config/vipLevels.ts
// Single source of truth for the VIP R0–R9 level structure on the backend.
//
// IMPORTANT: These figures represent the business's intended investment/return
// structure and must be validated by the business and legal team before being
// presented as guaranteed outcomes. They are configurable business data, kept
// in one place so they can be updated without touching service code.

export interface VipLevelConfig {
  id: number;
  code: string;
  name: string;
  investment: number;
  dailyReturn: number;
  tier: number;
  description: string;
  status: 'active' | 'coming-soon';
}

export const VIP_LEVELS: VipLevelConfig[] = [
  { id: 0, code: 'R0', name: 'Starter', investment: 10_000, dailyReturn: 300, tier: 0, description: 'Entry-level membership to begin exploring the platform.', status: 'active' },
  { id: 1, code: 'R1', name: 'Bronze', investment: 30_000, dailyReturn: 900, tier: 1, description: 'First upgrade with access to additional activities.', status: 'active' },
  { id: 2, code: 'R2', name: 'Silver', investment: 100_000, dailyReturn: 3_000, tier: 2, description: 'Intermediate tier with broader task availability.', status: 'active' },
  { id: 3, code: 'R3', name: 'Gold', investment: 250_000, dailyReturn: 7_500, tier: 3, description: 'Established tier offering enhanced reward potential.', status: 'active' },
  { id: 4, code: 'R4', name: 'Platinum', investment: 500_000, dailyReturn: 15_000, tier: 4, description: 'Advanced tier for committed members.', status: 'active' },
  { id: 5, code: 'R5', name: 'Diamond', investment: 1_000_000, dailyReturn: 30_000, tier: 5, description: 'High-tier membership with premium benefits.', status: 'active' },
  { id: 6, code: 'R6', name: 'Emerald', investment: 2_500_000, dailyReturn: 75_000, tier: 6, description: 'Elite tier reserved for serious participants.', status: 'active' },
  { id: 7, code: 'R7', name: 'Sapphire', investment: 5_000_000, dailyReturn: 150_000, tier: 7, description: 'Premium elite tier with expanded capacity.', status: 'active' },
  { id: 8, code: 'R8', name: 'Ruby', investment: 10_000_000, dailyReturn: 300_000, tier: 8, description: 'Top-tier membership for advanced members.', status: 'active' },
  { id: 9, code: 'R9', name: 'Crown', investment: 19_000_000, dailyReturn: 570_000, tier: 9, description: 'The highest available tier on the platform.', status: 'active' },
];

export const VIP_DISCLAIMER =
  'The investment and return figures shown are configurable business data and do not constitute a guarantee of returns. All participation involves risk. Figures are subject to validation and change by the platform operator.';

export function getLevelByCode(code: string): VipLevelConfig | undefined {
  return VIP_LEVELS.find((level) => level.code === code.toUpperCase());
}

export function getLevelByTier(tier: number): VipLevelConfig | undefined {
  return VIP_LEVELS.find((level) => level.tier === tier);
}

/** Levels strictly above the given tier, ordered ascending. */
export function levelsAbove(tier: number): VipLevelConfig[] {
  return VIP_LEVELS.filter((level) => level.tier > tier);
}
