// src/services/userService.ts
// User service – owns user-facing read/write operations.
//
// Database access is encapsulated here so controllers stay thin and routes
// contain no business logic. Future phases (wallet, VIP) will add their own
// services but may reuse helpers exposed here.

import { User, IUser, UserRole, AccountStatus } from '../models/User';
import {
  UserDTO,
  UpdateProfileDTO,
  UpdatePreferencesDTO,
  PROTECTED_USER_FIELDS,
} from '../types/dto';
import { Types } from 'mongoose';

function toDTO(user: IUser): UserDTO {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    role: user.role as UserRole,
    status: user.status as AccountStatus,
    referralCode: user.referralCode,
    emailVerified: true,
    phoneVerified: false,
    preferences: {
      email: user.preferences?.email ?? true,
      system: user.preferences?.system ?? true,
      marketing: user.preferences?.marketing ?? false,
    },
    lastLoginAt: user.lastLoginAt?.toISOString(),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/**
 * Reject any attempt to patch a privileged/protected field.
 * Returns a sanitised payload containing only allowed keys.
 */
function stripProtectedFields(input: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (PROTECTED_USER_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export const userService = {
  async getCurrentUser(userId: string | Types.ObjectId): Promise<UserDTO | null> {
    const user = await User.findById(userId);
    return user ? toDTO(user) : null;
  },

  async updateProfile(userId: string, patch: UpdateProfileDTO): Promise<UserDTO | null> {
    const sanitised = stripProtectedFields(patch as unknown as Record<string, unknown>);
    // Only allow explicitly editable fields.
    const allowed: UpdateProfileDTO = {};
    if (typeof sanitised.fullName === 'string') allowed.fullName = sanitised.fullName;
    if (typeof sanitised.phone === 'string') allowed.phone = sanitised.phone || undefined;
    if (typeof sanitised.avatarUrl === 'string') allowed.avatarUrl = sanitised.avatarUrl || undefined;

    const user = await User.findByIdAndUpdate(userId, { $set: allowed }, { new: true });
    return user ? toDTO(user) : null;
  },

  async updatePreferences(
    userId: string,
    patch: UpdatePreferencesDTO
  ): Promise<UserDTO | null> {
    const set: UpdatePreferencesDTO = {};
    if (typeof patch.email === 'boolean') set.email = patch.email;
    if (typeof patch.system === 'boolean') set.system = patch.system;
    if (typeof patch.marketing === 'boolean') set.marketing = patch.marketing;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { preferences: set } },
      { new: true }
    );
    return user ? toDTO(user) : null;
  },

  /** True when the user is permitted to access the user dashboard. */
  async isDashboardEligible(userId: string): Promise<boolean> {
    const user = await User.findById(userId).select('status');
    if (!user) return false;
    return user.status === AccountStatus.ACTIVE;
  },
};
