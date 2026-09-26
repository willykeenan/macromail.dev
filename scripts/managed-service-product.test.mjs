import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const pageExists = (name) => existsSync(new URL(`../src/app/app/${name}/page.tsx`, import.meta.url));

test("the apex is one self-host product, not an audience-switched demo", async () => {
  const [page, nav, metadata, docs] = await Promise.all([
    read("../src/app/(marketing)/page.tsx"),
    read("../src/components/marketing/MarketingNav.tsx"),
    read("../src/app/layout.tsx"),
    read("../src/app/(marketing)/docs/page.tsx"),
  ]);
  assert.doesNotMatch(page, /DeveloperHome|PersonalHome|AUDIENCE_COOKIE|AudienceToggle/);
  assert.match(page, /self-hostable email tool for AI agents/);
  assert.match(page, /github.com\/willykeenan\/macromail/);
  assert.match(page, /Internet inbound is not available/);
  assert.match(docs, /REST v1/);
  assert.match(docs, /\/api\/mcp/);
  assert.doesNotMatch(nav, /AudienceToggle|Developer view|\$29 plan|Pricing|Integrations/);
  assert.match(metadata, /self-hostable email tool for AI agents/);
});

test("removed marketing pages are gone and docs is a real page", async () => {
  const { existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const name of [
    "agents",
    "changelog",
    "contact",
    "enterprise",
    "inbox",
    "integrations",
    "migrate",
    "platform",
    "pricing",
  ]) {
    assert.equal(existsSync(join(root, "src/app/(marketing)", name, "page.tsx")), false);
  }
  const docs = await read("../src/app/(marketing)/docs/page.tsx");
  assert.doesNotMatch(docs, /redirect\(/);
  assert.match(docs, /Self-host/);
});

test("portal navigation lists the working self-host surfaces", async () => {
  const nav = await read("../src/lib/app-nav.ts");
  for (const route of [
    "/app/overview",
    "/app/mailboxes",
    "/app/inbox",
    "/app/send",
    "/app/api-keys",
    "/app/accounts",
    "/app/settings",
  ]) {
    assert.match(nav, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(nav, /Broadcasts|Audiences|Domains|Webhooks|Billing|Authority|Activity/);
});

test("removed commercial dashboard pages are gone", () => {
  for (const name of [
    "billing",
    "activity",
    "authority",
    "audiences",
    "broadcasts",
    "templates",
    "webhooks",
    "logs",
    "domains",
    "emails",
  ]) {
    assert.equal(pageExists(name), false, name);
  }
});

test("working dashboard pages exist", () => {
  for (const name of ["overview", "mailboxes", "inbox", "send", "api-keys", "accounts", "settings"]) {
    assert.equal(pageExists(name), true, name);
  }
});

test("overview reports real mailbox and SMTP state", async () => {
  const [overview, nav] = await Promise.all([
    read("../src/app/app/overview/page.tsx"),
    read("../src/lib/app-nav.ts"),
  ]);
  assert.match(overview, /getOverviewStats/);
  assert.match(overview, /Internet inbound is not available/);
  assert.doesNotMatch(overview, /Credits|ledger|\$29/);
  assert.doesNotMatch(nav, /Credits|ledger|\$29/);
});

test("portal chrome stays usable on small screens", async () => {
  const topbar = await read("../src/components/app/TopBar.tsx");
  assert.match(topbar, /Open portal menu/);
  assert.match(topbar, /Portal navigation/);
  assert.match(topbar, /Signed in/);
});

test("connected-inbox send is a plain read-only refusal", async () => {
  const route = await read("../src/app/api/inbox/send/route.ts");
  assert.match(route, /read_only/);
  assert.doesNotMatch(route, /sendEmail|deliverEmail|fetch\(|sendAndLog|holdAgentSend|recordHeldSend/);
});

test("public health is useful without exposing transport identities or KE leftovers", async () => {
  const health = await read("../src/app/api/health/route.ts");
  assert.match(health, /Cache-Control.*no-store/s);
  assert.match(health, /authentication/);
  assert.doesNotMatch(health, /monitoring|textUpdates|authority/);
  assert.doesNotMatch(health, /smtp\?\.host|smtp\?\.user|fromDomain/);
});

test("post-signup routing stays inside the authenticated product", async () => {
  const auth = await read("../src/lib/auth-actions.ts");
  assert.match(auth, /safePostAuthPath\(clean\(formData, "next"\), "\/app\/accounts"\)/);
  assert.match(auth, /redirect\(next\)/);
});
