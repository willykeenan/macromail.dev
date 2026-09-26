import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveTokenEncryptionKey } from "../src/lib/crypto.ts";

test("deployed token encryption requires its dedicated key", () => {
  assert.equal(
    resolveTokenEncryptionKey({
      NODE_ENV: "production",
      TOKEN_ENC_KEY: "configured-key",
    }).length,
    32,
  );
  assert.throws(
    () => resolveTokenEncryptionKey({ NODE_ENV: "production" }),
    /TOKEN_ENC_KEY is required/,
  );
});

test("the authenticated shell gates /app behind a signed session cookie", async () => {
  const source = await readFile(
    new URL("../src/middleware.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /SESSION_COOKIE/);
  assert.match(source, /verifySessionCookie/);
  assert.match(source, /pathname = "\/login"/);
  assert.doesNotMatch(source, /don't lock anyone out/i);
});

test("the dead legacy /auth/callback route is gone and sign-up makes no billing claims", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(new URL("../src/app/auth/callback/route.ts", import.meta.url)), false);
  const form = await readFile(new URL("../src/components/auth/AuthForm.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(form, /card is charged|oauth_error/i);
  assert.match(form, /role="alert"/);
  assert.doesNotMatch(form, /error\.message/);
});

test("mailbox OAuth state is cryptographic, browser-bound, expiring, and cleared", async () => {
  const connect = await readFile(
    new URL("../src/app/api/inbox/connect/[provider]/route.ts", import.meta.url),
    "utf8",
  );
  const callback = await readFile(
    new URL("../src/app/api/inbox/callback/[provider]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(connect, /randomBytes\(18\)/);
  assert.match(connect, /httpOnly: true/);
  assert.match(callback, /decoded\.nonce !== nonce/);
  assert.match(callback, /age > OAUTH_STATE_TTL_MS/);
  assert.match(callback, /expires: new Date\(0\)/);
});

test("settings and connection errors do not overclaim unavailable security controls", async () => {
  const settings = await readFile(
    new URL("../src/app/app/settings/page.tsx", import.meta.url),
    "utf8",
  );
  const accounts = await readFile(
    new URL("../src/components/inbox/AccountsClient.tsx", import.meta.url),
    "utf8",
  );
  const home = await readFile(
    new URL("../src/app/(marketing)/page.tsx", import.meta.url),
    "utf8",
  );
  const docs = await readFile(
    new URL("../src/app/(marketing)/docs/page.tsx", import.meta.url),
    "utf8",
  );
  const content = await readFile(
    new URL("../src/lib/content.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /getProfileSettings/);
  assert.match(settings, /SettingsForms/);
  assert.doesNotMatch(settings, /const OWNER_EMAIL/);
  assert.doesNotMatch(settings, /redirect\(/);
  assert.match(accounts, /provider_callback_failed/);
  assert.doesNotMatch(accounts, /GOOGLE_CLIENT_ID|MICROSOFT_CLIENT_ID/);
  assert.doesNotMatch(accounts, /decodeURIComponent\(code\)/);
  assert.match(content, /IMAP is not shipped/);
  assert.match(home, /IMAP is not shipped/);
  assert.match(docs, /IMAP is not shipped/);
  assert.doesNotMatch(
    `${home}\n${docs}\n${content}`,
    /any IMAP account|any other account|every account you already have/,
  );
});
