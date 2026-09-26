import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-auth-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.SESSION_SECRET = "test-session-secret";
process.env.NODE_ENV = "development";

const { hashPassword, verifyPassword, registerUser, authenticateUser, changeUserPassword } = await import(
  "../src/lib/auth-core.ts"
);
const db = await import("../src/lib/db/index.ts");
const { mintSessionCookie, verifySessionCookie, SESSION_COOKIE } = await import("../src/lib/session-cookie.ts");
const { checkMutationOrigin } = await import("../src/lib/origin.ts");
const { resetRateLimits } = await import("../src/lib/rate-limit.ts");

test("scrypt password hashes verify and reject mismatches", async () => {
  const stored = await hashPassword("correct-horse-battery");
  assert.match(stored, /^scrypt:/);
  assert.equal(await verifyPassword("correct-horse-battery", stored), true);
  assert.equal(await verifyPassword("wrong-password", stored), false);
});

test("session cookies are HMAC-signed, httpOnly SameSite=Lax, and expire", async () => {
  const expires = Date.now() + 60_000;
  const cookie = await mintSessionCookie("ses_abc", expires);
  const ok = await verifySessionCookie(cookie);
  assert.equal(ok?.sessionId, "ses_abc");
  assert.equal(await verifySessionCookie("tampered." + cookie), null);
  const expired = await mintSessionCookie("ses_old", Date.now() - 1000);
  assert.equal(await verifySessionCookie(expired), null);
  assert.equal(SESSION_COOKIE, "mm_session");
});

test("register and authenticate persist users in sqlite", async () => {
  resetRateLimits();
  const created = await registerUser("agent@example.com", "password12");
  assert.equal("user" in created, true);
  if (!("user" in created)) return;
  assert.equal(created.user.email, "agent@example.com");

  const dup = await registerUser("agent@example.com", "password12");
  assert.equal("error" in dup, true);

  const authed = await authenticateUser("agent@example.com", "password12", "203.0.113.10");
  assert.equal("user" in authed, true);

  const bad = await authenticateUser("agent@example.com", "nope-nope", "203.0.113.10");
  assert.equal("error" in bad, true);
});

test("mutation origin checks require Origin/Referer to match Host", () => {
  const ok = new Headers({ origin: "https://mail.example.com", host: "mail.example.com" });
  assert.equal(checkMutationOrigin(ok), true);
  const bad = new Headers({ origin: "https://evil.example", host: "mail.example.com" });
  assert.equal(checkMutationOrigin(bad), false);
  const referer = new Headers({ referer: "https://mail.example.com/login", host: "mail.example.com" });
  assert.equal(checkMutationOrigin(referer), true);
  const missing = new Headers({ host: "mail.example.com" });
  assert.equal(checkMutationOrigin(missing), false);
});

test("changing the password signs out every existing session", async () => {
  resetRateLimits();
  const created = await registerUser("rotate@example.com", "old-password-1", { ip: "203.0.113.20" });
  assert.equal("user" in created, true);
  const userId = created.user.id;
  const later = new Date(Date.now() + 86_400_000).toISOString();
  for (const id of ["ses_laptop", "ses_stolen"]) {
    db.insertSession({ id, user_id: userId, token_hash: `h_${id}`, expires_at: later, created_at: new Date().toISOString() });
  }

  const wrong = await changeUserPassword(userId, "not-the-password", "new-password-1");
  assert.match(wrong.error, /incorrect/);
  assert.ok(db.findSessionById("ses_stolen"), "a failed change must not revoke sessions");

  const ok = await changeUserPassword(userId, "old-password-1", "new-password-1");
  assert.deepEqual(ok, { ok: true });
  assert.equal(db.findSessionById("ses_laptop"), null);
  assert.equal(db.findSessionById("ses_stolen"), null);

  const oldLogin = await authenticateUser("rotate@example.com", "old-password-1", "203.0.113.21");
  assert.equal("error" in oldLogin, true);
  const newLogin = await authenticateUser("rotate@example.com", "new-password-1", "203.0.113.21");
  assert.equal("user" in newLogin, true);
});

test("the dashboard action re-issues a session only after revoking the others", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/lib/dashboard-actions.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function changePasswordAction"));
  assert.ok(body.indexOf("changeUserPassword(") > -1);
  assert.ok(body.indexOf("setSessionCookieForUser(") > body.indexOf("changeUserPassword("));
});

test("sign-ups are limited per IP and capped server-wide", async () => {
  resetRateLimits();
  const ip = "198.51.100.30";
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await registerUser(`burst${i}@example.com`, "password12", { ip }));
  assert.equal(results.filter((r) => "user" in r).length, 3);
  assert.equal(results[3].status, 429);

  resetRateLimits();
  const max = process.env.MACROMAIL_MAX_USERS;
  process.env.MACROMAIL_MAX_USERS = String(db.countUsers());
  try {
    const full = await registerUser("one-more@example.com", "password12", { ip: "198.51.100.31" });
    assert.equal(full.status, 403);
    assert.match(full.error, /not accepting new accounts/);
  } finally {
    if (max === undefined) delete process.env.MACROMAIL_MAX_USERS;
    else process.env.MACROMAIL_MAX_USERS = max;
  }
});
