// src/services/adminBootstrap.ts
// Ensures the platform administrator account exists and matches the
// ADMIN_USERNAME / ADMIN_PASSWORD environment variables.
//
// Runs once at server startup (after the DB connection is open):
//   - ADMIN_USERNAME unset  → no-op (bootstrap disabled).
//   - account missing       → created with role ADMIN and the env password.
//   - account exists        → promoted to ADMIN (if a regular user) and the
//     password is re-synced whenever it no longer matches ADMIN_PASSWORD, so
//     rotating the admin password is a pure .env change + restart.

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
      role: UserRole.ADMIN,
      status: AccountStatus.ACTIVE,
    });
    console.log(`[admin] Admin account created for ${email} (sign in at /login).`);
    return;
  }

  // Account exists: make sure it is an administrator and that the password
  // matches the environment (env is the source of truth for admin access).
  let dirty = false;
  if (existing.role !== UserRole.ADMIN && existing.role !== UserRole.SUPER_ADMIN) {
    existing.role = UserRole.ADMIN;
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
    console.log(`[admin] Admin account for ${email} was synced with ADMIN_* env credentials.`);
  }
}