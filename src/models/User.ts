// src/models/User.ts
// User schema with profile fields, preferences, and auth artefacts.

import { Schema, model, Document, Types } from 'mongoose';
import { hashPassword, verifyPassword } from '../utils/password';

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  SUPPORT = 'SUPPORT',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  DEACTIVATED = 'DEACTIVATED',
}

/** Notification preference channels. Defaults are permissive. */
export interface NotificationPreferences {
  email: boolean;
  system: boolean;
  marketing: boolean;
}

export interface IUser extends Document {
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  passwordHash: string;
  role: UserRole;
  status: AccountStatus;
  referralCode: string;
  referredBy?: Types.ObjectId;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  preferences: NotificationPreferences;
  lastLoginAt?: Date;
  /** Active VIP tier index (0 = R0 Starter … 9 = R9 Crown). */
  vipLevel: number;
  vipActivatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  setPassword(password: string): Promise<void>;
  comparePassword(candidate: string): Promise<boolean>;
}

const PreferencesSchema = new Schema<NotificationPreferences>(
  {
    email: { type: Boolean, default: true },
    system: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, maxlength: 24 },
    avatarUrl: { type: String, trim: true, maxlength: 2048 },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER, index: true },
    status: {
      type: String,
      enum: Object.values(AccountStatus),
      default: AccountStatus.PENDING_VERIFICATION,
      index: true,
    },
    referralCode: { type: String, unique: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    emailVerificationToken: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    preferences: { type: PreferencesSchema, default: () => ({}) },
    lastLoginAt: { type: Date },
    vipLevel: { type: Number, default: 0, min: 0, max: 9 },
    vipActivatedAt: { type: Date },
  },
  { timestamps: true }
);

// Index for lookup by verification / reset tokens (kept out of the default
// projection via `select: false` above).
UserSchema.index({ emailVerificationToken: 1 }, { sparse: true });
UserSchema.index({ passwordResetToken: 1 }, { sparse: true });

// Generate a unique 8-character referral code.
UserSchema.statics.generateReferralCode = async function (): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  let exists = true;
  while (exists) {
    code = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const count = await this.countDocuments({ referralCode: code });
    exists = count > 0;
  }
  return code;
};

UserSchema.pre<IUser>('save', async function (next) {
  // Hash password if it has been modified.
  if (this.isModified('passwordHash')) {
    this.passwordHash = await hashPassword(this.passwordHash);
  }
  // Ensure referral code exists.
  if (!this.referralCode) {
    this.referralCode = await (this.constructor as any).generateReferralCode();
  }
  next();
});

UserSchema.methods.setPassword = async function (password: string): Promise<void> {
  // Store the plain password; the pre('save') hook hashes it on commit.
  this.passwordHash = password;
};

UserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  return verifyPassword(this.passwordHash, candidate);
};

export const User = model<IUser>('User', UserSchema);
