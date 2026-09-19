// src/types/dto.ts
// Shared Data Transfer Objects returned by user-facing endpoints.
//
// These are the *public* shapes sent to the client. They intentionally exclude
// sensitive fields (passwordHash, tokens) and are consumed by the frontend
// API layer.

import type { UserRole, AccountStatus } from '../models/User';
import { NotificationType } from '../models/Notification';

export interface UserDTO {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  status: AccountStatus;
  referralCode: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  preferences: {
    email: boolean;
    system: boolean;
    marketing: boolean;
  };
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummaryDTO {
  user: Pick<
    UserDTO,
    'id' | 'fullName' | 'email' | 'role' | 'status' | 'referralCode' | 'emailVerified'
  >;
  // Financial fields are placeholders until the wallet/ledger phase.
  // They are explicitly zero/empty – not fabricated values.
  availableBalance: number;
  totalEarnings: number;
  totalDeposits: number;
  totalWithdrawals: number;
  referralEarnings: number;
  vip: {
    level: string; // e.g. "R0"
    levelName: string;
    tier: number;
  };
  tasks: {
    available: number;
    completed: number;
  };
  referrals: {
    total: number;
    active: number;
  };
  notifications: {
    unread: number;
  };
}

export interface UpdateProfileDTO {
  fullName?: string;
  phone?: string;
  avatarUrl?: string;
}

export interface UpdatePreferencesDTO {
  email?: boolean;
  system?: boolean;
  marketing?: boolean;
}

export interface VipLevelDTO {
  id: number;
  code: string;
  name: string;
  investment: number;
  dailyReturn: number;
  tier: number;
  description: string;
  status: string;
}

export interface VipStatusDTO {
  current: VipLevelDTO;
  next?: VipLevelDTO;
  activatedAt?: string;
  pendingPurchase?: VipPurchaseDTO;
}

export interface VipPurchaseDTO {
  id: string;
  levelCode: string;
  levelName: string;
  amount: number;
  status: string;
  reviewNote?: string;
  createdAt: string;
  reviewedAt?: string;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationListDTO {
  items: NotificationDTO[];
  total: number;
  unread: number;
}

/**
 * The set of fields a client is NEVER allowed to modify through profile
 * endpoints. Used by the user service to strip attempted privileged writes.
 */
export const PROTECTED_USER_FIELDS: readonly string[] = [
  'role',
  'status',
  'accountStatus',
  'vipLevel',
  'balance',
  'earnings',
  'referredBy',
  'referralCode',
  'passwordHash',
  'emailVerificationToken',
  'emailVerificationExpires',
  'passwordResetToken',
  'passwordResetExpires',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
  '_id',
  'id',
] as const;
