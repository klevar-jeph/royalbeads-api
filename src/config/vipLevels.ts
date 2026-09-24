// src/config/vipLevels.ts
// Central membership configuration. Keep the financial figures and task rules
// together so every backend and frontend surface uses the same catalogue.

export interface VipLevelConfig {
  id: number;
  code: string;
  name: string;
  investment: number;
  dailyReturn: number;
  taskCount: number;
  taskReward: number;
  tier: number;
  description: string;
  status: 'active' | 'coming-soon';
}

export const VIP_LEVELS: VipLevelConfig[] = [
  { id: 0, code: 'INTERN', name: 'Intern', investment: 0, dailyReturn: 500, taskCount: 4, taskReward: 125, tier: 0, description: 'Entry membership with a zero-deposit start.', status: 'active' },
  { id: 1, code: 'R1', name: 'R1', investment: 15_000, dailyReturn: 500, taskCount: 4, taskReward: 125, tier: 1, description: 'First paid membership level.', status: 'active' },
  { id: 2, code: 'R2', name: 'R2', investment: 30_000, dailyReturn: 1_000, taskCount: 8, taskReward: 125, tier: 2, description: 'Expanded daily task allocation.', status: 'active' },
  { id: 3, code: 'R3', name: 'R3', investment: 108_000, dailyReturn: 3_600, taskCount: 16, taskReward: 225, tier: 3, description: 'Growing membership with increased task rewards.', status: 'active' },
  { id: 4, code: 'R4', name: 'R4', investment: 250_000, dailyReturn: 9_700, taskCount: 30, taskReward: 250, tier: 4, description: 'Advanced membership tier.', status: 'active' },
  { id: 5, code: 'R5', name: 'R5', investment: 500_000, dailyReturn: 19_400, taskCount: 50, taskReward: 300, tier: 5, description: 'Higher-volume daily activity tier.', status: 'active' },
  { id: 6, code: 'R6', name: 'R6', investment: 1_000_000, dailyReturn: 38_800, taskCount: 75, taskReward: 400, tier: 6, description: 'Premium membership tier.', status: 'active' },
  { id: 7, code: 'R7', name: 'R7', investment: 2_500_000, dailyReturn: 97_500, taskCount: 150, taskReward: 500, tier: 7, description: 'Elite membership tier.', status: 'active' },
  { id: 8, code: 'R8', name: 'R8', investment: 5_000_000, dailyReturn: 195_000, taskCount: 200, taskReward: 750, tier: 8, description: 'Advanced elite membership tier.', status: 'active' },
  { id: 9, code: 'R9', name: 'R9', investment: 10_000_000, dailyReturn: 390_000, taskCount: 250, taskReward: 1_200, tier: 9, description: 'Top standard membership tier.', status: 'active' },
  { id: 10, code: 'MASTER', name: 'Master', investment: 19_000_000, dailyReturn: 760_000, taskCount: 300, taskReward: 1_900, tier: 10, description: 'The highest available membership tier.', status: 'active' },
];

export const VIP_DISCLAIMER =
  'Membership investment and return figures are configurable business data and do not constitute a guarantee of returns. All participation involves risk. Figures are subject to validation and change by the platform operator.';

export function getLevelByCode(code: string): VipLevelConfig | undefined {
  return VIP_LEVELS.find((level) => level.code === code.toUpperCase());
}

export function getLevelByTier(tier: number): VipLevelConfig | undefined {
  return VIP_LEVELS.find((level) => level.tier === tier);
}

export function levelsAbove(tier: number): VipLevelConfig[] {
  return VIP_LEVELS.filter((level) => level.tier > tier);
}

