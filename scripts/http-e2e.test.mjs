/**
 * End-to-end checks against the real production server (`next start`).
 * Requires `npm run build` first; skipped when there is no build.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const built = existsSync(join(root, ".next", "BUILD_ID"));

const dataDir = mkdtempSync(join(tmpdir(), "mm-e2e-"));
process.env.MACROMAIL_DATA_DIR = dataDir;
process.env.TOKEN_ENC_KEY = "e2e-token-encryption-key";
process.env.SESSION_SECRET = "e2e-session-secret";
process.env.NODE_ENV = "production";
delete process.env.MACROMAIL_MAILBOX_DOMAINS;

const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

let server = null;
let base = "";
let serverLog = "";
let cookie = "";
let aliceKey = "";
let malloryKey = "";

async function rss() {
  const { execFileSync } = await import("node:child_process");
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(server.pid)]).toString().trim()) * 1024;
}

test.before(async () => {
  if (!built) return;
  const db = await import("../src/lib/db/index.ts");
  const { createApiKey } = await import("../src/lib/api-keys.ts");
  const { mintSessionCookie } = await import("../src/lib/session-cookie.ts");
  const { createMailbox } = await import("../src/lib/mailboxes.ts");
  const now = new Date().toISOString();
  for (const u of ["alice", "mallory"]) {
    db.insertUser({ id: `usr_${u}`, email: `${u}@example.org`, password_hash: "scrypt:x:y", created_at: now });
  }
  aliceKey = (await createApiKey({ userId: "usr_alice", name: "a", scope: "full_access", env: "live" })).token;
  malloryKey = (await createApiKey({ userId: "usr_mallory", name: "m", scope: "full_access", env: "live" })).token;
  await createMailbox("usr_alice", "alice-agent@example.com", "Alice agent");
  const expires = Date.now() + 3_600_000;
  db.insertSession({ id: "ses_alice", user_id: "usr_alice", token_hash: "h", expires_at: new Date(expires).toISOString(), created_at: now });
  cookie = `mm_session=${await mintSessionCookie("ses_alice", expires)}`;
  db.closeDb();

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (d) => (serverLog += d));
  server.stderr.on("data", (d) => (serverLog += d));
  for (let i = 0; i < 150; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start:\n${serverLog.slice(-2000)}`);
});

test.after(() => {
  if (server) server.kill("SIGKILL");
  rmSync(dataDir, { recursive: true, force: true });
});

const skip = built ? false : "no .next build (run `npm run build` first)";

test("/app/mailboxes and /app/send render for an account that has a mailbox", { skip }, async () => {
  for (const path of ["/app/mailboxes", "/app/send"]) {
    const res = await fetch(base + path, { headers: { cookie } });
    const html = await res.text();
    assert.equal(res.status, 200, `${path}: ${res.status}`);
    assert.doesNotMatch(html, /couldn.t load|Application error/i, path);
    assert.match(html, /alice-agent@example\.com/, path);
  }
  assert.doesNotMatch(serverLog, /null prototypes|Only plain objects/);
});

test("an oversized unauthenticated MCP body is refused without buffering it", { skip }, async () => {
  const before = await rss();
  const res = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(50_000_000) } }),
  });
  assert.equal(res.status, 413);
  const after = await rss();
  assert.ok(after - before < 60 * 1024 * 1024, `RSS grew ${Math.round((after - before) / 1048576)} MB`);
});

test("a chunked body with no Content-Length is cut off at the cap", { skip }, async () => {
  const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= 5 * 1024 * 1024) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const res = await fetch(`${base}/api/v1/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${aliceKey}`, "content-type": "application/json" },
    body,
    duplex: "half",
  });
  assert.equal(res.status, 413);
});

test("REST refuses mailbox squatting and forged internal senders", { skip }, async () => {
  const squat = await fetch(`${base}/api/v1/mailboxes`, {
    method: "POST",
    headers: { authorization: `Bearer ${malloryKey}`, "content-type": "application/json" },
    body: JSON.stringify({ address: "ceo.x@bigco.com" }),
  });
  assert.equal(squat.status, 403);

  const forged = await fetch(`${base}/api/v1/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${malloryKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "Alice CEO <ceo@acme.test>", to: "alice-agent@example.com", subject: "x", text: "x", internal_only: true }),
  });
  assert.equal(forged.status, 403);
});

test("public discovery is MacroMail and the legacy callback is gone", { skip }, async () => {
  const contract = await (await fetch(`${base}/api/v1/agent-contract`)).json();
  assert.equal(contract.data.name, "MacroMail");
  const mcp = await (await fetch(`${base}/api/mcp`)).json();
  assert.equal(mcp.service, "MacroMail MCP");
  const cb = await fetch(`${base}/auth/callback?code=x`, { redirect: "manual" });
  assert.equal(cb.status, 404);
});
