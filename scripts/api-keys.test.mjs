import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-keys-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";

const { insertUser } = await import("../src/lib/db/index.ts");
const { createApiKey, authenticateKey, generateToken, tokenPrefix } = await import("../src/lib/api-keys.ts");

insertUser({
  id: "usr_keys",
  email: "keys@example.com",
  password_hash: "scrypt:x:y",
  created_at: new Date().toISOString(),
});

test("live tokens use the mm_live_ prefix and are stored hashed", async () => {
  const token = generateToken("live");
  assert.match(token, /^mm_live_[0-9a-z]{32}$/);
  assert.match(tokenPrefix(token), /^mm_live_/);

  const created = await createApiKey({
    userId: "usr_keys",
    name: "CI",
    scope: "full_access",
    env: "live",
  });
  assert.match(created.token, /^mm_live_/);
  assert.equal(created.row.prefix.startsWith("mm_live_"), true);
  assert.equal(created.row.prefix.includes("…"), true);
  assert.notEqual(created.row.prefix, created.token);
});

test("authenticateKey accepts Bearer mm_live_ tokens and rejects unknowns", async () => {
  const created = await createApiKey({
    userId: "usr_keys",
    name: "API",
    scope: "sending_only",
    env: "live",
  });
  const req = new Request("https://example.com/api/v1/emails", {
    headers: { authorization: `Bearer ${created.token}` },
  });
  const authed = await authenticateKey(req);
  assert.equal(authed?.userId, "usr_keys");
  assert.equal(authed?.scope, "sending_only");
  assert.equal(authed?.env, "live");

  const bad = await authenticateKey(
    new Request("https://example.com/api/v1/emails", {
      headers: { authorization: "Bearer mm_live_notarealtoken0000000000000000" },
    }),
  );
  assert.equal(bad, null);
});
