import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MACROMAIL_DATA_DIR = mkdtempSync(join(tmpdir(), "mm-mcp-"));
process.env.TOKEN_ENC_KEY = "test-token-encryption-key-for-local-tests";
process.env.NODE_ENV = "development";

const { insertUser } = await import("../src/lib/db/index.ts");
const { createApiKey } = await import("../src/lib/api-keys.ts");
const { MCP_TOOLS, MCP_TOOL_MAP, toolAllowedForScope } = await import("../src/lib/mcp/tools.ts");
const mcpRoute = await import("../src/app/api/mcp/route.ts");

insertUser({
  id: "usr_mcp",
  email: "mcp@example.com",
  password_hash: "scrypt:x:y",
  created_at: new Date().toISOString(),
});
const key = await createApiKey({
  userId: "usr_mcp",
  name: "mcp",
  scope: "full_access",
  env: "live",
});
const authed = { keyId: key.row.id, userId: "usr_mcp", scope: "full_access", env: "live" };

const EXPECTED = [
  "send_email",
  "list_emails",
  "get_email",
  "list_domains",
  "create_domain",
  "list_accounts",
  "search_inbox",
  "read_thread",
  "triage_inbox",
  "draft_reply",
  "create_mailbox",
  "list_mailboxes",
  "read_mailbox",
];

test("every listed MCP tool is registered and callable", () => {
  assert.deepEqual(
    MCP_TOOLS.map((t) => t.name),
    EXPECTED,
  );
  for (const name of EXPECTED) {
    assert.equal(typeof MCP_TOOL_MAP[name].handler, "function");
    assert.equal(toolAllowedForScope(name, "full_access"), true);
  }
  assert.equal(toolAllowedForScope("create_mailbox", "sending_only"), false);
  assert.equal(toolAllowedForScope("send_email", "sending_only"), true);
});

test("create_mailbox, send_email, list/get email, and read_mailbox work end to end", async () => {
  const createdFrom = await MCP_TOOL_MAP.create_mailbox.handler(authed, {
    address: "from-bot@example.com",
    display_name: "From",
  });
  assert.equal(createdFrom.mailbox.address, "from-bot@example.com");
  assert.equal(createdFrom.inbound, "internal_only");

  const createdTo = await MCP_TOOL_MAP.create_mailbox.handler(authed, {
    address: "to-bot@example.com",
  });
  assert.equal(createdTo.mailbox.address, "to-bot@example.com");

  const listedBoxes = await MCP_TOOL_MAP.list_mailboxes.handler(authed, {});
  assert.equal(listedBoxes.mailboxes.length, 2);
  assert.match(listedBoxes.note, /Internet inbound is not available/i);

  const sent = await MCP_TOOL_MAP.send_email.handler(authed, {
    from: "from-bot@example.com",
    to: "to-bot@example.com",
    subject: "Internal ping",
    text: "hello agent",
  });
  assert.equal(sent.status, "internal");
  assert.equal(sent.internal_deliveries, 1);
  assert.match(sent.id, /^em_/);

  const listed = await MCP_TOOL_MAP.list_emails.handler(authed, { limit: 10 });
  assert.equal(listed.count, 1);
  assert.equal(listed.emails[0].subject, "Internal ping");

  const got = await MCP_TOOL_MAP.get_email.handler(authed, { id: sent.id });
  assert.equal(got.subject, "Internal ping");
  assert.equal(got.text, "hello agent");

  const unread = await MCP_TOOL_MAP.read_mailbox.handler(authed, {
    address: "to-bot@example.com",
    unread_only: true,
    mark_read: true,
  });
  assert.equal(unread.messages.length, 1);
  assert.equal(unread.marked_read, 1);
  assert.equal(unread.inbound, "internal_only");

  const after = await MCP_TOOL_MAP.read_mailbox.handler(authed, {
    address: "to-bot@example.com",
    unread_only: true,
  });
  assert.equal(after.messages.length, 0);
});

test("create_domain and list_domains persist local records", async () => {
  const created = await MCP_TOOL_MAP.create_domain.handler(authed, { name: "mail.example.com" });
  assert.equal(created.domain, "mail.example.com");
  const listed = await MCP_TOOL_MAP.list_domains.handler(authed, {});
  assert.equal(listed.count, 1);
  assert.equal(listed.domains[0].domain, "mail.example.com");
});

test("inbox tools run honestly without connected OAuth accounts", async () => {
  const accounts = await MCP_TOOL_MAP.list_accounts.handler(authed, {});
  assert.equal(accounts.count, 0);

  const search = await MCP_TOOL_MAP.search_inbox.handler(authed, { query: "invoice" });
  assert.equal(search.count, 0);

  await assert.rejects(
    () => MCP_TOOL_MAP.read_thread.handler(authed, { thread_id: "acct_missing::thread" }),
    /Thread not found/,
  );

  const triage = await MCP_TOOL_MAP.triage_inbox.handler(authed, { limit: 5 });
  assert.equal(triage.triaged, 0);

  await assert.rejects(
    () => MCP_TOOL_MAP.draft_reply.handler(authed, { thread_id: "acct_missing::thread" }),
    /AI requires an Anthropic API key|Thread not found/,
  );
});

test("AI tools use the account's stored Anthropic key, not a process env key", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-env-must-not-be-used";
  const { encryptSecret } = await import("../src/lib/crypto.ts");
  const { patchSettings } = await import("../src/lib/db/index.ts");
  const { resolveUserAnthropicKey } = await import("../src/lib/inbox/service.ts");

  const none = await resolveUserAnthropicKey("usr_mcp");
  assert.equal(none, null);

  patchSettings("usr_mcp", { anthropic_key_enc: encryptSecret("sk-ant-user-stored-key") });
  const stored = await resolveUserAnthropicKey("usr_mcp");
  assert.equal(stored, "sk-ant-user-stored-key");
  const override = await resolveUserAnthropicKey("usr_mcp", "sk-ant-header-key");
  assert.equal(override, "sk-ant-header-key");
});

test("MCP tools use the x-anthropic-key header when the account has no stored key", async () => {
  const { patchSettings } = await import("../src/lib/db/index.ts");
  patchSettings("usr_mcp", { anthropic_key_enc: null });

  // No key anywhere: the AI gate refuses before touching the thread.
  await assert.rejects(
    () => MCP_TOOL_MAP.draft_reply.handler(authed, { thread_id: "acct_missing::thread" }, {}),
    /AI requires an Anthropic API key/,
  );
  // Header key: the AI gate passes and the handler reaches the thread lookup.
  await assert.rejects(
    () => MCP_TOOL_MAP.draft_reply.handler(authed, { thread_id: "acct_missing::thread" }, { anthropicKey: "sk-ant-header" }),
    /Thread not found/,
  );
});

const rpc = (body, headers = {}) =>
  mcpRoute.POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

test("MCP route passes x-anthropic-key through to tools/call", async () => {
  const call = { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "draft_reply", arguments: { thread_id: "acct_missing::thread" } } };
  const without = await (await rpc(call, { authorization: `Bearer ${key.token}` })).json();
  assert.match(without.result.content[0].text, /AI requires an Anthropic API key/);
  const withHeader = await (await rpc(call, { authorization: `Bearer ${key.token}`, "x-anthropic-key": "sk-ant-header" })).json();
  assert.equal(withHeader.result.isError, true);
  assert.match(withHeader.result.content[0].text, /Thread not found/);
});

test("MCP identifies as MacroMail and rejects oversized bodies and batches", async () => {
  const init = await (await rpc({ jsonrpc: "2.0", id: 1, method: "initialize" })).json();
  assert.equal(init.result.serverInfo.name, "macromail");
  assert.equal(init.result.serverInfo.title, "MacroMail");
  assert.doesNotMatch(JSON.stringify(init), /\bke_|\bdirector\b/i);

  const big = await rpc({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(1_100_000) } });
  assert.equal(big.status, 413);

  const tooMany = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
  const batch = await rpc(tooMany);
  assert.equal(batch.status, 400);
  assert.match((await batch.json()).error.message, /1 to 20/);

  const okBatch = await rpc(tooMany.slice(0, 20));
  assert.equal(okBatch.status, 200);
  assert.equal((await okBatch.json()).length, 20);

  const unknown = await (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "constructor" } }, { authorization: `Bearer ${key.token}` })).json();
  assert.match(unknown.error.message, /Unknown tool/);
});
