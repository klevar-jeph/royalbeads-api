// src/utils/password.ts
// Utility functions for password hashing and verification using Argon2id.
// Argon2id is the recommended variant for resisting both side‑channel and GPU attacks.
// The functions are async because Argon2 performs CPU‑intensive work.

import argon2 from "argon2";

/**
 * Hash a plain‑text password using Argon2id.
 *
 * The function uses a high‑memory, high‑time configuration that is safe for
 * production workloads while still being performant on typical server hardware.
 *
 * @param password Plain‑text password supplied by the user.
 * @returns The hashed password string that can be stored directly in the DB.
 */
export async function hashPassword(password: string): Promise<string> {
  // Argon2id with default parameters is already secure, but we explicitly set
  // a memory cost of 64 MiB and a time cost of 3 iterations - a good balance.
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024, // 64 MiB (in KiB)
    timeCost: 3,
    hashLength: 32,
  });
}

/**
 * Verify a plain‑text password against a stored Argon2 hash.
 *
 * @param hash      The stored hash (as produced by `hashPassword`).
 * @param password  The candidate plain‑text password.
 * @returns `true` if the password matches the hash, otherwise `false`.
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // If verification throws (e.g., malformed hash) we treat it as a mismatch.
    return false;
  }
}
