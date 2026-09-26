/**
 * In-process fixed-window counters. Fine for a single self-hosted Node process.
 *
 * Expired buckets are swept as the map grows, and the map has a hard size cap,
 * so a stream of never-repeating keys cannot grow memory without bound.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/** Sweep expired buckets once the map is larger than this. */
export const SWEEP_THRESHOLD = 5_000;
/** Hard cap: oldest buckets are evicted beyond this many live keys. */
export const MAX_BUCKETS = 50_000;
let lastSweepAt = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  lastSweepAt = now;
}

function makeRoom(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return;
  // Full sweeps are O(n); run at most once a second so a key flood cannot
  // turn every request into a scan.
  if (now - lastSweepAt >= 1_000) sweep(now);
  // Still full of live keys: evict the oldest insertions.
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

/**
 * Consume `cost` units from `key`'s window. A request that would exceed the
 * limit is refused and consumes nothing.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
  cost = 1,
): RateLimitResult {
  const units = Math.max(1, Math.floor(cost));
  let bucket = buckets.get(key);
  if (bucket && now >= bucket.resetAt) {
    buckets.delete(key);
    bucket = undefined;
  }
  if (!bucket) {
    if (units > limit) {
      return { ok: false, remaining: limit, retryAfterSec: Math.ceil(windowMs / 1000), limit };
    }
    makeRoom(now);
    buckets.set(key, { count: units, resetAt: now + windowMs });
    return { ok: true, remaining: Math.max(0, limit - units), retryAfterSec: Math.ceil(windowMs / 1000), limit };
  }
  const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count + units > limit) {
    return { ok: false, remaining: Math.max(0, limit - bucket.count), retryAfterSec, limit };
  }
  bucket.count += units;
  return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterSec, limit };
}

/** Check several limits; all must pass. Stops at the first refusal. */
function all(checks: (() => RateLimitResult)[]): RateLimitResult {
  let last: RateLimitResult = { ok: true, remaining: Infinity, retryAfterSec: 0, limit: Infinity };
  for (const check of checks) {
    const result = check();
    if (!result.ok) return result;
    if (result.remaining < last.remaining) last = result;
  }
  return last;
}

export function rateLimitBucketCount(): number {
  return buckets.size;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/* ───────────────────────── login ───────────────────────── */

/** Login: 5 attempts / 15 minutes per email+ip. */
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * MINUTE;
/** Per existing account, from any IP. */
export const LOGIN_ACCOUNT_LIMIT = 10;
/** Per client IP, across all emails. */
export const LOGIN_IP_LIMIT = 30;

/**
 * Login limits: email+ip, per client IP, and — when the email belongs to a
 * real account — per account regardless of IP. The account key uses the user
 * id, so unknown emails cannot mint unbounded account buckets.
 */
export function loginRateLimit(email: string, ip: string, accountId?: string | null): RateLimitResult {
  const e = email.trim().toLowerCase();
  const addr = ip || "unknown";
  const checks = [() => rateLimit(`login:pair:${e}:${addr}`, LOGIN_LIMIT, LOGIN_WINDOW_MS)];
  if (accountId) checks.push(() => rateLimit(`login:acct:${accountId}`, LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW_MS));
  checks.push(() => rateLimit(`login:ip:${addr}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS));
  return all(checks);
}

/* ───────────────────────── signup ───────────────────────── */

export const SIGNUP_IP_LIMIT = 3;
export const SIGNUP_GLOBAL_LIMIT = 30;
export const SIGNUP_WINDOW_MS = HOUR;

export function signupRateLimit(ip: string): RateLimitResult {
  return all([
    () => rateLimit(`signup:ip:${ip || "unknown"}`, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS),
    () => rateLimit("signup:global", SIGNUP_GLOBAL_LIMIT, SIGNUP_WINDOW_MS),
  ]);
}

/* ───────────────────────── sending ───────────────────────── */

/** Outbound SMTP: 30 sends / hour per user account. */
export const SEND_LIMIT = 30;
export const SEND_WINDOW_MS = HOUR;
/** Outbound SMTP across every account on this server. */
export const GLOBAL_SEND_LIMIT = 300;

export function sendRateLimit(userId: string): RateLimitResult {
  return all([
    () => rateLimit(`send:${userId}`, SEND_LIMIT, SEND_WINDOW_MS),
    () => rateLimit("send:global", GLOBAL_SEND_LIMIT, SEND_WINDOW_MS),
  ]);
}

/** Internal mailbox deliveries: 200 recipient copies / hour per sending account. */
export const INTERNAL_SEND_LIMIT = 200;

export function internalSendRateLimit(userId: string, copies: number): RateLimitResult {
  return rateLimit(`internal:${userId}`, INTERNAL_SEND_LIMIT, SEND_WINDOW_MS, Date.now(), copies);
}

/* ───────────────────────── SMTP settings ───────────────────────── */

export const SMTP_TEST_USER_LIMIT = 5;
export const SMTP_TEST_IP_LIMIT = 10;
export const SMTP_TEST_GLOBAL_LIMIT = 60;
export const SMTP_SAVE_USER_LIMIT = 10;

/** Live SMTP connection tests: per account, per IP, and server-wide. */
export function smtpTestRateLimit(userId: string, ip: string): RateLimitResult {
  return all([
    () => rateLimit(`smtp-test:user:${userId}`, SMTP_TEST_USER_LIMIT, HOUR),
    () => rateLimit(`smtp-test:ip:${ip || "unknown"}`, SMTP_TEST_IP_LIMIT, HOUR),
    () => rateLimit("smtp-test:global", SMTP_TEST_GLOBAL_LIMIT, HOUR),
  ]);
}

export function smtpSaveRateLimit(userId: string, ip: string): RateLimitResult {
  return all([
    () => rateLimit(`smtp-save:user:${userId}`, SMTP_SAVE_USER_LIMIT, HOUR),
    () => rateLimit(`smtp-save:ip:${ip || "unknown"}`, SMTP_SAVE_USER_LIMIT * 2, HOUR),
  ]);
}

export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = 0;
}
