// src/services/adminBootstrap.ts
// Ensures the platform SUPER ADMIN account exists and matches the
// ADMIN_USERNAME / ADMIN_PASSWORD environment variables.
//
// Runs once at server startup (after the DB connection is open):
//   - ADMIN_USERNAME unset  → no-op (bootstrap disabled).
//   - account missing       → created with role SUPER_ADMIN and the env password.
//   - account exists        → promoted to SUPER_ADMIN (unless it already is) and
//     the password is re-synced whenever it no longer matches ADMIN_PASSWORD, so
//     rotating the admin password is a pure .env change + restart.
//
// The super admin can grant and revoke admin access for any other user from the
// admin console (Users → Profile & controls → Role).

import { User, UserRole, AccountStatus } from '../models/User';
import { env } from '../config/env';

export async function ensureAdminAccount(): Promise<void> {
  const email = env.admin.username;
  if (!email) return; // Bootstrap disabled — nothing to do.

  const password = env.admin.password;
  const existing = await User.findOne({ email });

  if (!existing) {
    if (!password) {
      console.warn(
        `[admin] ADMIN_USERNAME is set to ${email} but no ADMIN_PASSWORD was provided — ` +
          'set ADMIN_PASSWORD in .env so the admin account can be created.'
      );
      return;
    }
    await User.create({
      fullName: 'Platform Administrator',
      email,
      phone: '',
      passwordHash: password, // hashed by the pre('save') hook
      role: UserRole.SUPER_ADMIN,
      status: AccountStatus.ACTIVE,
    });
    console.log(`[admin] Super admin account created for ${email} (sign in at /login).`);
    return;
  }

  // Account exists: make sure it is the SUPER ADMIN and that the password
  // matches the environment (env is the source of truth for admin access).
  let dirty = false;
  if (existing.role !== UserRole.SUPER_ADMIN) {
    existing.role = UserRole.SUPER_ADMIN;
    dirty = true;
  }
  if (existing.status !== AccountStatus.ACTIVE) {
    existing.status = AccountStatus.ACTIVE;
    dirty = true;
  }
  if (password && !(await existing.comparePassword(password))) {
    existing.passwordHash = password; // pre('save') hook re-hashes on commit
    dirty = true;
  }
  if (dirty) {
    await existing.save();
    console.log(`[admin] Super admin account for ${email} was synced with ADMIN_* env credentials.`);
  }
}