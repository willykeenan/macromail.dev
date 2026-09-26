import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
// Retired internal names are checked by hash so this public test never spells them.
const RETIRED_HASHES = new Set(["fd4150d6abdf75b38e8d44186366781ba74d1adca045499b50921c7d0dcb6c7c", "a99dad182db986b1977454efe99ce39f045551868bdfa5f0424a6e65ed4afdc3"]);
const RETIRED_LIB = process.env.MACROMAIL_RETIRED_LIB || "retired-internal-lib";
const RETIRED_NAMES = { test(text) { return String(text).toLowerCase().split(/[^a-z0-9_]+/).some((w) => RETIRED_HASHES.has(createHash("sha256").update(w).digest("hex"))) || /ke_connector|ke_brain|\bdirector\b|card is charged/i.test(String(text)); } };


process.env.NODE_ENV = "development";
process.env.MACROMAIL_DATA_DIR ??= (await import("node:fs")).mkdtempSync(join((await import("node:os")).tmpdir(), "mm-pub-"));

const root = join(fileURLToPath(import.meta.url), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
  });

test("docs, llms files, and errors point to the real pages for keys, SMTP, and the Anthropic key", () => {
  const files = [
    "src/lib/content.ts",
    "src/lib/integrations.ts",
    "src/lib/ai.ts",
    "src/lib/email/send.ts",
    "src/lib/dashboard-actions.ts",
    "src/app/(marketing)/page.tsx",
    "src/app/(marketing)/docs/page.tsx",
    "public/llms.txt",
    "public/llms-full.txt",
  ];
  for (const f of files) {
    const text = read(f);
    assert.doesNotMatch(text, /\b(on|in) Accounts\b|open Accounts|\/app\/accounts\b(?!\?)/, f);
  }
  assert.match(read("public/llms-full.txt"), /created on \/app\/api-keys/);
  assert.match(read("public/llms-full.txt"), /saved in \/app\/settings/);
  assert.match(read("src/lib/ai.ts"), /Settings \(\/app\/settings\)/);
  for (const f of ["src/components/inbox/InboxWorkspace.tsx", "src/components/inbox/AiAssistantPanel.tsx", "src/lib/dashboard-actions.ts"]) {
    assert.doesNotMatch(read(f), /in Accounts/, `${f} still rewrites "in Accounts"`);
  }
});

test("no retired internal product names on public surfaces", () => {
  const files = [...walk("src"), ...walk("public"), ".env.example", "docs/SELF-HOST.md", "README.md", "deploy/launchd/dev.macromail.plist.template"];
  for (const f of files) {
    if (/\.(png|ico|svg|jpg)$/.test(f)) continue;
    const text = read(f);
    assert.ok(!RETIRED_NAMES.test(text), f);
  }
  assert.equal(existsSync(join(root, "src/lib/" + RETIRED_LIB)), false);
  assert.equal(existsSync(join(root, "src/app/auth/callback/route.ts")), false);
});

test("the agent contract describes MacroMail", async () => {
  const route = await import("../src/app/api/v1/agent-contract/route.ts");
  const res = await route.GET(new Request("https://mail.example.org/api/v1/agent-contract"));
  const { data } = await res.json();
  assert.equal(data.name, "MacroMail");
  assert.equal(data.version, JSON.parse(read("package.json")).version);
  assert.equal(data.rest.base, "https://mail.example.org/api/v1");
  assert.equal(data.mcp.url, "https://mail.example.org/api/mcp");
  assert.ok(data.mcp.tools.includes("send_email"));
  assert.ok(data.rest.endpoints.some((e) => e.path === "/api/v1/emails" && e.method === "POST"));
  assert.deepEqual(data.mailboxes.domains, ["example.com"]);
  assert.ok(!RETIRED_NAMES.test(JSON.stringify(data)) && !/\bke_|\bdirector\b/i.test(JSON.stringify(data)));
});

test("health and MCP discovery carry no retired internal fields", async () => {
  const health = await import("../src/app/api/health/route.ts");
  const h = await (await health.GET()).json();
  assert.equal(h.service, "macromail");
  assert.equal("authority" in h, false);
  assert.equal("monitoring" in h.capabilities, false);
  assert.equal("textUpdates" in h.capabilities, false);

  const mcp = await import("../src/app/api/mcp/route.ts");
  const g = await (await mcp.GET()).json();
  assert.equal(g.service, "MacroMail MCP");
});

test("connected-inbox send answers with a plain read-only error", async () => {
  const route = await import("../src/app/api/inbox/send/route.ts");
  const res = await route.POST();
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "read_only");
});

test("server env docs only list variables the code reads", () => {
  const env = read(".env.example");
  const selfHost = read("docs/SELF-HOST.md");
  for (const text of [env, selfHost]) {
    assert.doesNotMatch(text, /^#?\s*(ANTHROPIC_API_KEY|SMTP_HOST|SMTP_PASS|AWS_REGION|AWS_ACCESS_KEY_ID)=/m);
    assert.doesNotMatch(text, /\bSES\b/);
  }
  assert.match(env, /MACROMAIL_MAILBOX_DOMAINS=/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal("@aws-sdk/client-sesv2" in pkg.dependencies, false);
  assert.equal(existsSync(join(root, "src/lib/email/ses.ts")), false);
  assert.equal(existsSync(join(root, "src/lib/email/ses-domains.ts")), false);
  // Every MACROMAIL_* var documented in .env.example is read somewhere in src.
  const src = walk("src").map((f) => read(f)).join("\n");
  for (const name of new Set(env.match(/MACROMAIL_[A-Z_]+/g))) assert.match(src, new RegExp(name), name);
});

test("test fixtures carry no personal data", () => {
  // Built from parts so this file does not match itself.
  // (The public GitHub handle in site links is not personal data.)
  const personal = new RegExp(["willi" + "am kee" + "nan", "kee" + "nan, willi" + "am", "kestud" + "ios", "willi" + "am@", "mer" + "z@"].join("|"), "i");
  for (const f of walk("scripts")) {
    assert.doesNotMatch(read(f), personal, f);
  }
});
