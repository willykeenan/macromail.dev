import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { id } from "@/lib/ids";
import {
  countUsers,
  deleteSessionsForUser,
  findUserByEmail,
  findUserById,
  insertUser,
  updateUserPassword,
  type UserRow,
} from "@/lib/db";
import { maxUsers } from "@/lib/limits";
import { loginRateLimit, signupRateLimit } from "@/lib/rate-limit";

const scryptAsync = promisify(scrypt);

export interface AuthUser {
  id: string;
  email: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const key = (await scryptAsync(password, salt, 64)) as Buffer;
    if (key.length !== expected.length) return false;
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export function toAuthUser(user: UserRow): AuthUser {
  return { id: user.id, email: user.email };
}

export const MAX_PASSWORD_LENGTH = 256;

export async function registerUser(
  email: string,
  password: string,
  opts?: { ip?: string },
): Promise<{ user: AuthUser } | { error: string; existing?: boolean; status?: number }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@") || normalized.length > 254) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password.length > MAX_PASSWORD_LENGTH) return { error: "Password must be at most 256 characters." };
  if (findUserByEmail(normalized)) {
    return { error: "That email is already registered. Try signing in instead.", existing: true };
  }
  if (countUsers() >= maxUsers()) {
    return { error: "This MacroMail server is not accepting new accounts.", status: 403 };
  }
  const limited = signupRateLimit(opts?.ip ?? "unknown");
  if (!limited.ok) {
    return { error: "Too many new accounts from this network. Try again later.", status: 429 };
  }
  const user: UserRow = {
    id: id("usr"),
    email: normalized,
    password_hash: await hashPassword(password),
    created_at: new Date().toISOString(),
  };
  try {
    insertUser(user);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/unique/i.test(msg)) {
      return { error: "That email is already registered. Try signing in instead.", existing: true };
    }
    throw e;
  }
  return { user: toAuthUser(user) };
}

export async function authenticateUser(
  email: string,
  password: string,
  ip: string,
): Promise<{ user: AuthUser } | { error: string; status?: number }> {
  const normalized = email.trim().toLowerCase();
  const user = normalized.length <= 254 ? findUserByEmail(normalized) : null;
  const limited = loginRateLimit(normalized, ip, user?.id ?? null);
  if (!limited.ok) {
    return { error: "Too many sign-in attempts. Try again in a few minutes.", status: 429 };
  }
  if (!user || password.length > MAX_PASSWORD_LENGTH || !(await verifyPassword(password, user.password_hash))) {
    return { error: "Invalid email or password." };
  }
  return { user: toAuthUser(user) };
}

/**
 * Change a password and revoke every session for the account. The caller
 * issues a fresh session for the browser that made the change.
 */
export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<{ ok: true } | { error: string }> {
  if (nextPassword.length < 8) return { error: "New password must be at least 8 characters." };
  if (nextPassword.length > MAX_PASSWORD_LENGTH) return { error: "New password must be at most 256 characters." };
  const row = findUserById(userId);
  if (!row) return { error: "Account not found." };
  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    return { error: "Current password is incorrect." };
  }
  updateUserPassword(userId, await hashPassword(nextPassword));
  deleteSessionsForUser(userId);
  return { ok: true };
}

export { findUserById };
