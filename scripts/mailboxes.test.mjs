import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-mbx-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";
delete process.env.MACROMAIL_MAILBOX_DOMAINS;

const { insertUser, trimMailboxMessages, countMailboxMessagesForBox, findMailboxByAddress } = await import(
  "../src/lib/db/index.ts"
);
const {
  createMailbox,
  listMailboxes,
  deliverToMailboxes,
  listMailboxMessages,
  markMailboxMessagesRead,
  mailboxDomains,
  isMailboxDomainAddress,
  INBOUND_NOTE,
} = await import("../src/lib/mailboxes.ts");
const { MAX_MAILBOXES_PER_USER } = await import("../src/lib/limits.ts");

for (const id of ["usr_a", "usr_b", "usr_many"]) {
  insertUser({ id, email: `${id}@example.org`, password_hash: "scrypt:x:y", created_at: new Date().toISOString() });
}

test("mailboxes are claimed per account and refuse foreign addresses", async () => {
  const one = await createMailbox("usr_a", "agent@example.com", "Agent");
  assert.equal(one.mailbox?.address, "agent@example.com");
  assert.equal(one.inbound, "internal_only");
  assert.match(one.note ?? "", /Internet inbound is not available/i);

  const again = await createMailbox("usr_a", "agent@example.com");
  assert.equal(again.existing, true);

  const clash = await createMailbox("usr_b", "agent@example.com");
  assert.match(clash.error ?? "", /already claimed/);
  assert.equal(clash.code, "address_taken");

  const listed = await listMailboxes("usr_a");
  assert.equal(listed.length, 1);
});

test("mailboxes can only be created on the server's mailbox domains (no squatting)", async () => {
  assert.deepEqual(mailboxDomains({}), ["example.com"]);
  for (const address of ["ceo.x@bigco.com", "bob@mail.example.org", "agent@example.com.evil.net", "x@sub.example.com"]) {
    const res = await createMailbox("usr_b", address);
    assert.equal(res.code, "domain_not_allowed", address);
    assert.match(res.error ?? "", /only be created on this server's domain/);
    assert.equal(findMailboxByAddress(address), null, address);
  }
  for (const address of ["Name <a@example.com>", "a@@example.com", "a b@example.com", "", "x".repeat(400) + "@example.com"]) {
    const res = await createMailbox("usr_b", address);
    assert.equal(res.code, "invalid_address", address.slice(0, 40));
  }
});

test("MACROMAIL_MAILBOX_DOMAINS sets the allowed domains", () => {
  const env = { MACROMAIL_MAILBOX_DOMAINS: " Agents.Acme.dev, @mail.acme.dev ,not a domain" };
  assert.deepEqual(mailboxDomains(env), ["agents.acme.dev", "mail.acme.dev"]);
  assert.equal(isMailboxDomainAddress("bot@agents.acme.dev", env), true);
  assert.equal(isMailboxDomainAddress("bot@acme.dev", env), false);
  assert.equal(isMailboxDomainAddress("bot@example.com", env), false);
});

test("an account can hold a bounded number of mailboxes", async () => {
  for (let i = 0; i < MAX_MAILBOXES_PER_USER; i++) {
    const res = await createMailbox("usr_many", `bot${i}@example.com`);
    assert.ok(res.mailbox, res.error);
  }
  const over = await createMailbox("usr_many", "one-too-many@example.com");
  assert.equal(over.code, "limit_reached");
});

test("internal delivery lands mail between MacroMail mailboxes", async () => {
  await createMailbox("usr_b", "bot@example.com", "Bot");
  const res = await deliverToMailboxes({
    emailId: "em_internal",
    from: "Agent <agent@example.com>",
    to: ["bot@example.com", "nobody@elsewhere.test"],
    subject: "Ping",
    text: "hello",
  });
  assert.equal(res.delivered, 1);
  const inbox = await listMailboxMessages("usr_b", "bot@example.com", { unreadOnly: true });
  assert.equal(inbox.messages?.length, 1);
  assert.equal(inbox.messages?.[0].from_addr, "agent@example.com");
  assert.equal(inbox.inbound, "internal_only");
  assert.equal(inbox.note, INBOUND_NOTE);

  const marked = await markMailboxMessagesRead("usr_b", "bot@example.com", [inbox.messages[0].id]);
  assert.equal(marked.updated, 1);
  const after = await listMailboxMessages("usr_b", "bot@example.com", { unreadOnly: true });
  assert.equal(after.messages?.length, 0);
});

test("Bcc recipients get a copy but are never listed in to_addrs", async () => {
  await createMailbox("usr_a", "lawyer@example.com");
  const res = await deliverToMailboxes({
    emailId: "em_bcc",
    from: "agent@example.com",
    to: ["bot@example.com"],
    cc: ["cc-person@elsewhere.test"],
    bcc: ["lawyer@example.com", "secret-lawyer@firm.test"],
    subject: "Private",
    text: "hello",
  });
  assert.equal(res.delivered, 2);
  const toBox = await listMailboxMessages("usr_b", "bot@example.com", { limit: 1 });
  assert.deepEqual(toBox.messages?.[0].to_addrs, ["bot@example.com", "cc-person@elsewhere.test"]);
  const bccBox = await listMailboxMessages("usr_a", "lawyer@example.com", { limit: 1 });
  assert.deepEqual(bccBox.messages?.[0].to_addrs, ["bot@example.com", "cc-person@elsewhere.test"]);
  for (const box of [toBox, bccBox]) {
    assert.doesNotMatch(JSON.stringify(box.messages), /lawyer/);
  }
});

test("mailboxes on domains that are no longer allowed stop receiving", async () => {
  const env = process.env.MACROMAIL_MAILBOX_DOMAINS;
  process.env.MACROMAIL_MAILBOX_DOMAINS = "agents.acme.dev";
  try {
    const res = await deliverToMailboxes({
      emailId: "em_stale",
      from: "agent@example.com",
      to: ["bot@example.com"],
      subject: "Stale",
      text: "x",
    });
    assert.equal(res.delivered, 0);
  } finally {
    if (env === undefined) delete process.env.MACROMAIL_MAILBOX_DOMAINS;
    else process.env.MACROMAIL_MAILBOX_DOMAINS = env;
  }
});

test("mailbox history is trimmed to the newest messages", async () => {
  const box = findMailboxByAddress("bot@example.com");
  const before = countMailboxMessagesForBox(box.id);
  assert.ok(before >= 2);
  const removed = trimMailboxMessages(box.id, 1);
  assert.equal(removed, before - 1);
  assert.equal(countMailboxMessagesForBox(box.id), 1);
  const left = await listMailboxMessages("usr_b", "bot@example.com");
  assert.equal(left.messages?.[0].subject, "Private");
});
