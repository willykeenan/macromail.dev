import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-rl-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";

const {
  loginRateLimit,
  sendRateLimit,
  resetRateLimits,
  LOGIN_LIMIT,
  LOGIN_ACCOUNT_LIMIT,
  SEND_LIMIT,
  rateLimit,
  rateLimitBucketCount,
  MAX_BUCKETS,
  SWEEP_THRESHOLD,
  smtpTestRateLimit,
  SMTP_TEST_USER_LIMIT,
  signupRateLimit,
  SIGNUP_IP_LIMIT,
} = await import("../src/lib/rate-limit.ts");
const { clientIpFromHeaders } = await import("../src/lib/client-ip.ts");
const {
  isPrivateOrReservedIp,
  isBlockedSmtpHostname,
  assertSafeSmtpHost,
  ALLOWED_SMTP_PORTS,
  smtpUsesStartTls,
  resolveSafeSmtpTarget,
} = await import("../src/lib/smtp-guard.ts");
const { authenticateUser, registerUser } = await import("../src/lib/auth-core.ts");

test("login rate limit blocks after the configured number of attempts", async () => {
  resetRateLimits();
  await registerUser("limited@example.com", "password12");
  for (let i = 0; i < LOGIN_LIMIT; i++) {
    const result = await authenticateUser("limited@example.com", "wrong-password", "198.51.100.9");
    assert.equal("error" in result, true);
    assert.notEqual(result.status, 429);
  }
  const blocked = await authenticateUser("limited@example.com", "password12", "198.51.100.9");
  assert.equal(blocked.status, 429);
  assert.match(blocked.error, /Too many sign-in attempts/);
});

test("per-account send rate limit trips after SEND_LIMIT", () => {
  resetRateLimits();
  for (let i = 0; i < SEND_LIMIT; i++) {
    assert.equal(sendRateLimit("usr_send").ok, true);
  }
  const blocked = sendRateLimit("usr_send");
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(sendRateLimit("usr_other").ok, true);
});

test("generic rate limiter resets after the window", () => {
  resetRateLimits();
  const t0 = 1_000_000;
  assert.equal(rateLimit("k", 2, 1000, t0).ok, true);
  assert.equal(rateLimit("k", 2, 1000, t0 + 10).ok, true);
  assert.equal(rateLimit("k", 2, 1000, t0 + 20).ok, false);
  assert.equal(rateLimit("k", 2, 1000, t0 + 1001).ok, true);
});

test("SMTP SSRF guard rejects loopback, private, and metadata hosts", async () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("10.0.0.5"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.1"), true);
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true);
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
  assert.equal(isBlockedSmtpHostname("localhost"), true);
  assert.equal(isBlockedSmtpHostname("metadata.google.internal"), true);
  assert.equal(ALLOWED_SMTP_PORTS.has(465), true);
  await assert.rejects(() => assertSafeSmtpHost("127.0.0.1", 465), /not allowed/);
  await assert.rejects(() => assertSafeSmtpHost("smtp.example.com", 9999), /port is not allowed/);
  // Port 25 is MTA relay, not submission: never allowed.
  assert.equal(ALLOWED_SMTP_PORTS.has(25), false);
  await assert.rejects(() => assertSafeSmtpHost("8.8.8.8", 25), /port is not allowed/);
  assert.equal(smtpUsesStartTls(465), false);
  assert.equal(smtpUsesStartTls(587), true);
  const pinned = await resolveSafeSmtpTarget("8.8.8.8", 465);
  assert.equal(pinned.address, "8.8.8.8");
  assert.equal(pinned.servername, "8.8.8.8");
});

test("client IP ignores the client-controlled start of X-Forwarded-For", () => {
  const ip = (h, env = {}) => clientIpFromHeaders(new Headers(h), env);
  // Cloudflare / Tailscale append the address they saw; a client can only prepend.
  assert.equal(ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }), "203.0.113.7");
  assert.equal(ip({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.7" }), "203.0.113.7");
  // Local hops (cloudflared, Docker) are skipped.
  assert.equal(ip({ "x-forwarded-for": "6.6.6.6, 203.0.113.7, 127.0.0.1" }), "203.0.113.7");
  assert.equal(ip({ "x-forwarded-for": "127.0.0.1" }), "127.0.0.1");
  assert.equal(ip({ "x-forwarded-for": "not-an-ip, 203.0.113.9" }), "203.0.113.9");
  // CF-Connecting-IP is only trusted when the operator says every request is from Cloudflare.
  assert.equal(ip({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "203.0.113.7" }), "203.0.113.7");
  assert.equal(
    ip({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "203.0.113.7" }, { MACROMAIL_TRUSTED_PROXY: "cloudflare" }),
    "198.51.100.4",
  );
  assert.equal(ip({}), "unknown");
});

test("a spoofed X-Forwarded-For per request no longer bypasses the login limit", async () => {
  resetRateLimits();
  await registerUser("xff@example.com", "password12", { ip: "198.51.100.1" });
  const statuses = [];
  for (let i = 0; i < 8; i++) {
    // Each request claims a different first hop; the proxy-added last hop is the same.
    const headers = new Headers({ "x-forwarded-for": `10.9.${i}.1, 45.${i}.3.4, 203.0.113.50` });
    const r = await authenticateUser("xff@example.com", "wrong-password", clientIpFromHeaders(headers, {}));
    statuses.push(r.status ?? 401);
  }
  assert.deepEqual(statuses.slice(0, LOGIN_LIMIT), Array(LOGIN_LIMIT).fill(401));
  assert.ok(statuses.slice(LOGIN_LIMIT).every((s) => s === 429), statuses.join(","));
});

test("the per-account login limit holds even when every attempt has a new IP", async () => {
  resetRateLimits();
  await registerUser("acct@example.com", "password12", { ip: "198.51.100.2" });
  let blockedAt = -1;
  for (let i = 0; i < LOGIN_ACCOUNT_LIMIT + 2; i++) {
    const r = await authenticateUser("acct@example.com", "wrong-password", `203.0.113.${i + 1}`);
    if (r.status === 429) {
      blockedAt = i;
      break;
    }
  }
  assert.equal(blockedAt, LOGIN_ACCOUNT_LIMIT);
  // The right password is refused too while the account is limited.
  const ok = await authenticateUser("acct@example.com", "password12", "203.0.113.200");
  assert.equal(ok.status, 429);
});

test("unknown emails do not create per-account buckets", () => {
  resetRateLimits();
  for (let i = 0; i < 50; i++) loginRateLimit(`nobody${i}@example.com`, "203.0.113.77", null);
  // one ip bucket + 50 pair buckets, no account buckets
  assert.equal(rateLimitBucketCount(), 51);
});

test("rate limiter memory is bounded", () => {
  resetRateLimits();
  const t0 = 5_000_000;
  for (let i = 0; i < SWEEP_THRESHOLD + 10; i++) rateLimit(`old:${i}`, 1, 1000, t0);
  assert.ok(rateLimitBucketCount() >= SWEEP_THRESHOLD);
  // Once the window has passed, the next insert sweeps expired buckets.
  rateLimit("fresh", 1, 1000, t0 + 5_000);
  assert.ok(rateLimitBucketCount() < 10, `after sweep: ${rateLimitBucketCount()}`);

  resetRateLimits();
  for (let i = 0; i < MAX_BUCKETS + 500; i++) rateLimit(`live:${i}`, 1, 60_000, t0);
  assert.ok(rateLimitBucketCount() <= MAX_BUCKETS);
  resetRateLimits();
});

test("rate limits accept a cost and refuse without consuming", () => {
  resetRateLimits();
  const t0 = 9_000_000;
  assert.equal(rateLimit("c", 10, 1000, t0, 8).ok, true);
  assert.equal(rateLimit("c", 10, 1000, t0, 3).ok, false);
  assert.equal(rateLimit("c", 10, 1000, t0, 2).ok, true);
  assert.equal(rateLimit("big", 5, 1000, t0, 6).ok, false);
});

test("SMTP connection tests and sign-ups are rate limited", () => {
  resetRateLimits();
  for (let i = 0; i < SMTP_TEST_USER_LIMIT; i++) assert.equal(smtpTestRateLimit("usr_x", "203.0.113.5").ok, true);
  assert.equal(smtpTestRateLimit("usr_x", "203.0.113.6").ok, false);
  assert.equal(smtpTestRateLimit("usr_y", "203.0.113.6").ok, true);

  for (let i = 0; i < SIGNUP_IP_LIMIT; i++) assert.equal(signupRateLimit("203.0.113.8").ok, true);
  assert.equal(signupRateLimit("203.0.113.8").ok, false);
  assert.equal(signupRateLimit("203.0.113.9").ok, true);
  resetRateLimits();
});
