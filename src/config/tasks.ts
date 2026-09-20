// src/config/tasks.ts
// Seed definitions for the daily tasks engine. These are synced into the
// `tasks` collection (keyed, idempotent) so reward amounts and availability
// can be tuned in the database without code changes.

export interface TaskSeed {
  key: string;
  title: string;
  description: string;
  reward: number;
  minVipTier: number;
  dailyLimit: number;
  active: boolean;
  sortOrder: number;
}

export const TASK_SEEDS: TaskSeed[] = [
  {
    key: 'daily-checkin',
    title: 'Daily check-in',
    description: 'Visit the platform and check in once per day to claim your reward.',
    reward: 50,
    minVipTier: 0,
    dailyLimit: 1,
    active: true,
    sortOrder: 10,
  },
  {
    key: 'watch-promo',
    title: 'Watch promotional content',
    description: 'View a promotional video or banner set selected by the platform.',
    reward: 150,
    minVipTier: 0,
    dailyLimit: 3,
    active: true,
    sortOrder: 20,
  },
  {
    key: 'survey',
    title: 'Complete a survey',
    description: 'Answer a short survey. Higher VIP tiers unlock more surveys per day.',
    reward: 250,
    minVipTier: 1,
    dailyLimit: 2,
    active: true,
    sortOrder: 30,
  },
  {
    key: 'social-share',
    title: 'Share a platform update',
    description: 'Share the latest platform update on your social channel.',
    reward: 200,
    minVipTier: 2,
    dailyLimit: 1,
    active: true,
    sortOrder: 40,
  },
];
