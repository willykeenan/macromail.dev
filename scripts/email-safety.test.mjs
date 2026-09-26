import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertSendHeaders,
  canonicalMailbox,
  parseMailbox,
  resolveMessageIdDomain,
} from "../src/lib/email/address.ts";
import { apiKeyForcesSimulation } from "../src/lib/email/provider-policy.ts";

const projectFile = (path) => new URL(`../${path}`, import.meta.url);

test("mailboxes accept one canonical bare or display-name address", () => {
  assert.deepEqual(parseMailbox("Ada Lovelace <ada@EXAMPLE.org>"), {
    address: "ada@example.org",
    name: "Ada Lovelace",
    formatted: "Ada Lovelace <ada@example.org>",
  });
  assert.equal(canonicalMailbox('"Lovelace, Ada" <ada@example.org>'), '"Lovelace, Ada" <ada@example.org>');
  assert.equal(canonicalMailbox("recruiter@example.com"), "recruiter@example.com");
});

test("mailboxes reject injection, lists, and malformed addresses", () => {
  const invalid = [
    "ada@example.org\r\nBcc: victim@example.com",
    "Ada\nBcc: victim@example.com <ada@example.org>",
    "one@example.com, two@example.com",
    "missing-at.example.com",
    "user@example",
    "user..dots@example.com",
    "Ada <user@example.com> trailing",
  ];
  for (const value of invalid) assert.throws(() => parseMailbox(value));
});

test("every recipient and subject header receives defense-in-depth validation", () => {
  const valid = {
    from: "Ada <ada@example.org>",
    to: ["one@example.com"],
    cc: ["two@example.com"],
    bcc: ["three@example.com"],
    reply_to: "Ada <ada@example.org>",
    subject: "Research note",
  };
  assert.doesNotThrow(() => assertSendHeaders(valid));
  assert.throws(() => assertSendHeaders({ ...valid, to: ["bad"] }));
  assert.throws(() => assertSendHeaders({ ...valid, cc: ["two@example.com\r\nBcc: x@example.com"] }));
  assert.throws(() => assertSendHeaders({ ...valid, bcc: ["three@example"] }));
  assert.throws(() => assertSendHeaders({ ...valid, subject: "Hello\nBcc: x@example.com" }));
});

test("Message-ID domains prefer configured From domain and always have a public fallback", () => {
  assert.equal(resolveMessageIdDomain("Ada <ada@example.com>", "example.net"), "example.net");
  assert.equal(resolveMessageIdDomain("Ada <ada@example.com>"), "example.com");
  assert.equal(resolveMessageIdDomain("malformed"), "macromail.dev");
  assert.throws(() => resolveMessageIdDomain("ada@example.com", "not-a-domain"));
});

test("test API keys force simulation by policy", () => {
  assert.equal(apiKeyForcesSimulation("test"), true);
  assert.equal(apiKeyForcesSimulation("live"), false);
  assert.equal(apiKeyForcesSimulation(undefined), false);
});

test("REST and MCP delivery preserve key policy and use the user's SMTP account", async () => {
  const [single, batch, mcp, send, smtp] = await Promise.all([
    readFile(projectFile("src/app/api/v1/emails/route.ts"), "utf8"),
    readFile(projectFile("src/app/api/v1/emails/batch/route.ts"), "utf8"),
    readFile(projectFile("src/lib/mcp/tools.ts"), "utf8"),
    readFile(projectFile("src/lib/email/send.ts"), "utf8"),
    readFile(projectFile("src/lib/email/smtp.ts"), "utf8"),
  ]);

  assert.match(single, /apiKeyEnv:\s*authed\.env/);
  assert.match(batch, /apiKeyEnv:\s*authed\.env/);
  assert.doesNotMatch(batch, /Promise\.all\s*\(/);
  assert.match(mcp, /sendAndLog/);
  assert.match(mcp, /apiKeyEnv:\s*authed\.env/);
  assert.doesNotMatch(mcp, /sendReply|sendGmail|sendGraphMail/);
  assert.match(send, /loadUserSmtp|getSettings/);
  assert.match(send, /assertSafeSmtpHost/);
  assert.match(send, /sendRateLimit/);
  assert.doesNotMatch(smtp, /macromail\.local/);
  assert.match(smtp, /resolveMessageIdDomain\(input\.from, configuredFromDomain\)/);
  assert.match(smtp, /STARTTLS/);
  assert.match(smtp, /resolveSafeSmtpTarget/);
});
