import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-send-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";
delete process.env.MACROMAIL_MAILBOX_DOMAINS;
delete process.env.MACROMAIL_USER_STORAGE_MB;

const db = await import("../src/lib/db/index.ts");
const { encryptSecret } = await import("../src/lib/crypto.ts");
const { createMailbox, listMailboxMessages } = await import("../src/lib/mailboxes.ts");
const { sendAndLog, sendErrorStatus } = await import("../src/lib/email/send.ts");
const { sendSchema } = await import("../src/lib/email/schema.ts");
const { createApiKey } = await import("../src/lib/api-keys.ts");
const { resetRateLimits, INTERNAL_SEND_LIMIT } = await import("../src/lib/rate-limit.ts");
const { MAX_BODY_CHARS, MAX_RECIPIENTS } = await import("../src/lib/limits.ts");
const emailsRoute = await import("../src/app/api/v1/emails/route.ts");
const mailboxesRoute = await import("../src/app/api/v1/mailboxes/route.ts");

const now = new Date().toISOString();
for (const u of ["alice", "mallory", "bob", "quota", "rl"]) {
  db.insertUser({ id: `usr_${u}`, email: `${u}@example.org`, password_hash: "scrypt:x:y", created_at: now });
}
await createMailbox("usr_alice", "alice-agent@example.com", "Alice agent");
await createMailbox("usr_mallory", "mallory@example.com");
await createMailbox("usr_bob", "bob-agent@example.com");
await createMailbox("usr_quota", "quota@example.com");
await createMailbox("usr_rl", "rl@example.com");
await createMailbox("usr_rl", "rl-inbox@example.com");

const liveKey = async (userId) => (await createApiKey({ userId, name: "k", scope: "full_access", env: "live" })).token;
const testKey = async (userId) => (await createApiKey({ userId, name: "t", scope: "full_access", env: "test" })).token;
const post = (route, token, body) =>
  route.POST(
    new Request("http://localhost/api/v1/x", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const allMessages = () => db.getDb().prepare("SELECT * FROM mailbox_messages").all();

test("REST: another account cannot squat an outside domain and capture mail sent to it", async () => {
  const mallory = await liveKey("usr_mallory");
  const alice = await liveKey("usr_alice");

  const squat = await post(mailboxesRoute, mallory, { address: "ceo.x@bigco.com" });
  assert.equal(squat.status, 403);
  const body = await squat.json();
  assert.equal(body.error.code, "domain_not_allowed");
  assert.deepEqual(body.error.allowed_domains, ["example.com"]);

  // Plant a squatted row directly (e.g. from an older build): it must stay inert.
  db.insertMailbox({ id: "mbx_squat", user_id: "usr_mallory", address: "ceo.x@bigco.com", display_name: null, created_at: now });

  const before = allMessages().length;
  const send = await post(emailsRoute, alice, {
    from: "alice@realco.test",
    to: ["ceo.x@bigco.com"],
    subject: "Confidential",
    text: "secret",
  });
  // Outside domain → SMTP leg, and Alice has no SMTP: an honest failure, not "internal".
  assert.equal(send.status, 502);
  assert.equal((await send.json()).error.code, "no_smtp");
  assert.equal(allMessages().length, before);
});

test("internal copies are only delivered after the outbound leg succeeds", async () => {
  db.patchSettings("usr_alice", {
    smtp_host: "smtp.invalid",
    smtp_port: 465,
    smtp_user: "alice@realco.test",
    smtp_pass_enc: encryptSecret("pw"),
  });
  const before = allMessages().length;
  const res = await sendAndLog({
    from: "alice-agent@example.com",
    to: ["someone@realco.test"],
    cc: ["bob-agent@example.com"],
    subject: "Mixed",
    text: "hello",
    userId: "usr_alice",
    source: "api",
  });
  assert.equal(res.status, "failed");
  assert.equal(res.error_code, "send_failed");
  assert.equal(res.internal_deliveries, 0);
  assert.equal(allMessages().length, before);
  db.patchSettings("usr_alice", { smtp_host: null, smtp_user: null, smtp_pass_enc: null });
});

test("internal mail must come from one of the sender's own mailboxes", async () => {
  const mallory = await liveKey("usr_mallory");
  for (const from of ["Alice CEO <ceo@acme.test>", "alice-agent@example.com", "Alice <alice-agent@example.com>"]) {
    const res = await post(emailsRoute, mallory, {
      from,
      to: "alice-agent@example.com",
      subject: "Wire money",
      text: "do it",
      internal_only: true,
    });
    assert.equal(res.status, 403, from);
    assert.equal((await res.json()).error.code, "sender_not_owned");
  }
  const inbox = await listMailboxMessages("usr_alice", "alice-agent@example.com");
  assert.equal(inbox.messages?.length, 0);

  const ok = await post(emailsRoute, mallory, {
    from: "Mallory <mallory@example.com>",
    to: "alice-agent@example.com",
    subject: "Hello",
    text: "hi",
  });
  assert.equal(ok.status, 200);
  const sent = await ok.json();
  assert.equal(sent.status, "internal");
  assert.equal(sent.internal_deliveries, 1);
  const after = await listMailboxMessages("usr_alice", "alice-agent@example.com");
  assert.equal(after.messages?.[0].from_addr, "mallory@example.com");
});

test("internal_only refuses recipients outside the mailbox domains", async () => {
  const res = await sendAndLog({
    from: "alice-agent@example.com",
    to: ["bob@gmail.test"],
    subject: "x",
    text: "x",
    internal_only: true,
    userId: "usr_alice",
    source: "api",
  });
  assert.equal(res.error_code, "invalid_recipients");
  assert.equal(sendErrorStatus(res.error_code), 422);
});

test("Bcc recipients stay hidden from every internal copy", async () => {
  const res = await sendAndLog({
    from: "alice-agent@example.com",
    to: ["bob-agent@example.com"],
    bcc: ["mallory@example.com"],
    subject: "Bcc check",
    text: "x",
    userId: "usr_alice",
    source: "api",
  });
  assert.equal(res.status, "internal");
  assert.equal(res.internal_deliveries, 2);
  const bob = await listMailboxMessages("usr_bob", "bob-agent@example.com", { limit: 1 });
  const mal = await listMailboxMessages("usr_mallory", "mallory@example.com", { limit: 1 });
  assert.deepEqual(bob.messages?.[0].to_addrs, ["bob-agent@example.com"]);
  assert.deepEqual(mal.messages?.[0].to_addrs, ["bob-agent@example.com"]);
});

test("test keys simulate internal delivery too", async () => {
  const token = await testKey("usr_alice");
  const before = allMessages().length;
  const res = await post(emailsRoute, token, {
    from: "alice-agent@example.com",
    to: "bob-agent@example.com",
    subject: "Simulated",
    text: "x",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.simulated, true);
  assert.equal(body.internal_deliveries, 0);
  assert.equal(allMessages().length, before);
});

test("send requests are size-capped", async () => {
  const base = { from: "a@example.com", to: "b@example.com", subject: "s" };
  assert.equal(sendSchema.safeParse({ ...base, text: "x".repeat(MAX_BODY_CHARS) }).success, true);
  assert.equal(sendSchema.safeParse({ ...base, text: "x".repeat(MAX_BODY_CHARS + 1) }).success, false);
  assert.equal(sendSchema.safeParse({ ...base, text: "x", html: "x".repeat(MAX_BODY_CHARS + 1) }).success, false);
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `r${i}@example.com`);
  assert.equal(sendSchema.safeParse({ ...base, text: "x", to: many }).success, false);
  assert.equal(
    sendSchema.safeParse({ ...base, text: "x", to: many.slice(0, 30), cc: many.slice(30) }).success,
    false,
  );
  const tags = Array.from({ length: 11 }, (_, i) => ({ name: `t${i}`, value: "v" }));
  assert.equal(sendSchema.safeParse({ ...base, text: "x", tags }).success, false);
  assert.equal(sendSchema.safeParse({ ...base, text: "x", to: `${"a".repeat(330)}@example.com` }).success, false);

  const token = await testKey("usr_alice");
  const huge = await post(emailsRoute, token, { ...base, text: "x".repeat(2 * 1024 * 1024) });
  assert.equal(huge.status, 413);
  assert.equal((await huge.json()).error.code, "payload_too_large");
});

test("internal delivery is rate limited per account", async () => {
  resetRateLimits();
  let refused = null;
  for (let i = 0; i <= INTERNAL_SEND_LIMIT; i++) {
    const res = await sendAndLog({
      from: "rl@example.com",
      to: ["rl-inbox@example.com"],
      subject: `n${i}`,
      text: "x",
      userId: "usr_rl",
      source: "api",
    });
    if (res.status === "failed") {
      refused = { i, res };
      break;
    }
  }
  assert.ok(refused, "expected the internal rate limit to trip");
  assert.equal(refused.i, INTERNAL_SEND_LIMIT);
  assert.equal(refused.res.error_code, "rate_limited");
  assert.equal(sendErrorStatus(refused.res.error_code), 429);
  resetRateLimits();
});

test("stored mail per account is capped", async () => {
  process.env.MACROMAIL_USER_STORAGE_MB = "1";
  try {
    const big = "y".repeat(MAX_BODY_CHARS);
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(
        await sendAndLog({
          from: "quota@example.com",
          to: ["quota@example.com"],
          subject: "big",
          text: big,
          userId: "usr_quota",
          source: "api",
        }),
      );
    }
    assert.equal(results[0].status, "internal");
    const refused = results.find((r) => r.status === "failed");
    assert.ok(refused, "expected the storage quota to trip");
    assert.equal(refused.error_code, "quota_exceeded");
    assert.equal(sendErrorStatus(refused.error_code), 507);
    assert.ok(db.getStoredBytes("usr_quota") <= 1024 * 1024);
  } finally {
    delete process.env.MACROMAIL_USER_STORAGE_MB;
  }
});
