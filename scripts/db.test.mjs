import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-db-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";

const db = await import("../src/lib/db/index.ts");

test("MACROMAIL_DATA_DIR controls the sqlite path and pingDb checks the store", () => {
  assert.equal(db.resolveDataDir(), process.env.MACROMAIL_DATA_DIR);
  assert.match(db.resolveDbPath(), /macromail\.sqlite$/);
  assert.equal(db.pingDb(), true);
});

test("users, settings, sessions, and api keys persist", () => {
  const now = new Date().toISOString();
  db.insertUser({
    id: "usr_one",
    email: "owner@example.com",
    password_hash: "scrypt:aa:bb",
    created_at: now,
  });
  const user = db.findUserByEmail("owner@example.com");
  assert.equal(user?.id, "usr_one");
  assert.ok(db.getSettings("usr_one"));

  db.insertSession({
    id: "ses_one",
    user_id: "usr_one",
    token_hash: "abc",
    expires_at: now,
    created_at: now,
  });
  assert.equal(db.findSessionById("ses_one")?.user_id, "usr_one");

  db.insertApiKey({
    id: "key_one",
    user_id: "usr_one",
    name: "Live",
    prefix: "mm_live_abcd…",
    token_hash: "hash1",
    scope: "full_access",
    env: "live",
    last_used_at: null,
    created_at: now,
  });
  const found = db.findApiKeyByHash("hash1");
  assert.equal(found?.prefix.startsWith("mm_live_"), true);
  assert.equal(db.countApiKeysForUser("usr_one"), 1);
});

test("emails, domains, connected accounts, and thread_ai round-trip JSON columns", () => {
  const now = new Date().toISOString();
  db.insertEmail({
    id: "em_one",
    user_id: "usr_one",
    api_key_id: "key_one",
    from_addr: "owner@example.com",
    to_addrs: ["agent@example.com"],
    cc: null,
    bcc: null,
    reply_to: null,
    subject: "Hello",
    html: "<p>Hi</p>",
    text: "Hi",
    tags: [{ name: "campaign", value: "welcome" }],
    status: "internal",
    provider: "internal",
    provider_message_id: null,
    simulated: false,
    error: null,
    source: "api",
    created_at: now,
  });
  const listed = db.listEmailsForUser("usr_one", 10);
  assert.equal(listed[0].to_addrs[0], "agent@example.com");
  assert.equal(listed[0].tags?.[0].value, "welcome");
  assert.equal(listed[0].simulated, false);

  db.upsertDomain({
    id: "dom_one",
    user_id: "usr_one",
    domain: "example.com",
    status: "pending",
    region: "smtp",
    records: [{ type: "TXT", name: "example.com", value: "v=spf1", purpose: "SPF" }],
    verified_at: null,
    created_at: now,
  });
  assert.equal(db.listDomainsForUser("usr_one")[0].domain, "example.com");

  db.insertConnectedAccount({
    id: "acct_one",
    user_id: "usr_one",
    provider: "gmail",
    email: "reader@example.com",
    label: null,
    status: "connected",
    color: "#5B8CFF",
    access_token_enc: null,
    refresh_token_enc: null,
    token_expires_at: null,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    sync_cursor: null,
    last_sync_at: null,
    created_at: now,
  });
  assert.equal(db.listConnectedAccounts("usr_one")[0].scopes?.[0].includes("gmail.readonly"), true);

  db.upsertThreadAi({
    account_id: "acct_one",
    provider_thread_id: "t1",
    labels: ["important"],
    summary: "Pay invoice",
    updated_at: now,
  });
  assert.equal(db.listThreadAiForAccounts(["acct_one"])[0].summary, "Pay invoice");
});

test("every row leaving the DB layer is a plain object (React can serialize it)", () => {
  const now = new Date().toISOString();
  db.insertMailbox({ id: "mbx_plain", user_id: "usr_one", address: "plain@example.com", display_name: null, created_at: now });
  db.insertMailboxMessage({
    id: "mbm_plain",
    mailbox_id: "mbx_plain",
    user_id: "usr_one",
    email_id: null,
    from_addr: "a@example.com",
    from_name: null,
    to_addrs: ["plain@example.com"],
    subject: "s",
    text: "t",
    html: null,
    read: false,
    created_at: now,
  });
  const rows = [
    db.findUserByEmail("owner@example.com"),
    db.findUserById("usr_one"),
    db.findSessionById("ses_one"),
    db.getSettings("usr_one"),
    db.findApiKeyByHash("hash1"),
    ...db.listApiKeysForUser("usr_one"),
    db.findMailboxByAddress("plain@example.com"),
    ...db.listMailboxesForUser("usr_one"),
    ...db.listMailboxMessagesForBox("mbx_plain"),
    ...db.listEmailsForUser("usr_one"),
    db.getEmailForUser("usr_one", "em_one"),
    ...db.listDomainsForUser("usr_one"),
    ...db.listConnectedAccounts("usr_one"),
    ...db.listThreadAiForAccounts(["acct_one"]),
  ];
  assert.ok(rows.length >= 14);
  for (const row of rows) {
    assert.ok(row, "expected a row");
    assert.equal(Object.getPrototypeOf(row), Object.prototype, JSON.stringify(row).slice(0, 80));
  }
});

test("migration 002 adds per-account stored-bytes accounting", () => {
  assert.equal(typeof db.getStoredBytes("usr_one"), "number");
  const before = db.getStoredBytes("usr_one");
  db.addStoredBytes("usr_one", 1000);
  assert.equal(db.getStoredBytes("usr_one"), before + 1000);
});
