/**
 * MacroMail SQLite store. Location is MACROMAIL_DATA_DIR/macromail.sqlite
 * (default: ./data/macromail.sqlite).
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ApiKeyRow,
  ConnectedAccountRow,
  DnsRecord,
  DomainRow,
  EmailRow,
  MailboxMessageRow,
  MailboxRow,
  ThreadAiRow,
} from "@/lib/types/db";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface UserSettingsRow {
  user_id: string;
  email: string | null;
  plan: string;
  anthropic_key_enc: string | null;
  default_from: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass_enc: string | null;
  smtp_from_domain: string | null;
  operator_json: string | null;
  created_at: string;
  updated_at: string;
}

type SqlValue = string | number | null;

function nowIso(): string {
  return new Date().toISOString();
}

function jsonCol<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * node:sqlite returns rows with a null prototype. React refuses to pass those
 * from Server to Client Components, so every row leaving this module is copied
 * into a plain object.
 */
function plain<T>(row: unknown): T {
  return { ...(row as Record<string, unknown>) } as T;
}

function plainOrNull<T>(row: unknown): T | null {
  return row ? plain<T>(row) : null;
}

export function resolveDataDir(): string {
  const fromEnv = process.env.MACROMAIL_DATA_DIR?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : join(process.cwd(), "data");
}

export function resolveDbPath(): string {
  return join(resolveDataDir(), "macromail.sqlite");
}

let db: DatabaseSync | null = null;
let openPath: string | null = null;

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_init",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL,
  env TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mailbox_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email_id TEXT,
  from_addr TEXT NOT NULL,
  from_name TEXT,
  to_addrs TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT,
  html TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  api_key_id TEXT,
  from_addr TEXT NOT NULL,
  to_addrs TEXT NOT NULL,
  cc TEXT,
  bcc TEXT,
  reply_to TEXT,
  subject TEXT NOT NULL,
  html TEXT,
  text TEXT,
  tags TEXT,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connected_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL,
  color TEXT NOT NULL,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  sync_cursor TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thread_ai (
  account_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  labels TEXT NOT NULL,
  summary TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, provider_thread_id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  anthropic_key_enc TEXT,
  default_from TEXT,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  smtp_pass_enc TEXT,
  smtp_from_domain TEXT,
  operator_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  status TEXT NOT NULL,
  region TEXT NOT NULL,
  records TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(token_hash);
CREATE INDEX IF NOT EXISTS idx_mailboxes_user ON mailboxes(user_id);
CREATE INDEX IF NOT EXISTS idx_mailbox_messages_box ON mailbox_messages(mailbox_id, created_at);
CREATE INDEX IF NOT EXISTS idx_emails_user ON emails(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON connected_accounts(user_id);
`,
  },
  {
    name: "002_usage_quota",
    sql: `
ALTER TABLE user_settings ADD COLUMN stored_bytes INTEGER NOT NULL DEFAULT 0;
UPDATE user_settings SET stored_bytes = COALESCE((
  SELECT SUM(LENGTH(CAST(COALESCE(text, '') AS BLOB)) + LENGTH(CAST(COALESCE(html, '') AS BLOB)) + LENGTH(CAST(subject AS BLOB)) + 512)
  FROM emails WHERE emails.user_id = user_settings.user_id
), 0);
`,
  },
];

function migrate(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    database.prepare("SELECT name FROM schema_migrations").all().map((r) => String((r as { name: unknown }).name)),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    database.exec("BEGIN");
    try {
      database.exec(m.sql);
      database.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(m.name, nowIso());
      database.exec("COMMIT");
    } catch (e) {
      database.exec("ROLLBACK");
      throw e;
    }
  }
}

export function getDb(): DatabaseSync {
  const path = resolveDbPath();
  if (db && openPath === path) return db;
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
  mkdirSync(dirname(path), { recursive: true });
  const next = new DatabaseSync(path);
  next.exec("PRAGMA journal_mode = WAL");
  next.exec("PRAGMA foreign_keys = ON");
  migrate(next);
  db = next;
  openPath = path;
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* */
  }
  db = null;
  openPath = null;
}

export function pingDb(): boolean {
  const row = getDb().prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
  return row?.ok === 1;
}

/* ───────────────────────── users / sessions / settings ───────────────────────── */

export function insertUser(row: UserRow): void {
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.email, row.password_hash, row.created_at);
  const ts = row.created_at;
  getDb()
    .prepare(
      `INSERT INTO user_settings (user_id, email, plan, created_at, updated_at)
       VALUES (?, ?, 'free', ?, ?)`,
    )
    .run(row.id, row.email, ts, ts);
}

export function findUserByEmail(email: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ?")
    .get(email.toLowerCase());
  return plainOrNull<UserRow>(row);
}

export function findUserById(id: string): UserRow | null {
  const row = getDb()
    .prepare("SELECT id, email, password_hash, created_at FROM users WHERE id = ?")
    .get(id);
  return plainOrNull<UserRow>(row);
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function insertSession(row: SessionRow): void {
  getDb()
    .prepare(
      "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(row.id, row.user_id, row.token_hash, row.expires_at, row.created_at);
}

export function findSessionById(id: string): SessionRow | null {
  const row = getDb()
    .prepare("SELECT id, user_id, token_hash, expires_at, created_at FROM sessions WHERE id = ?")
    .get(id);
  return plainOrNull<SessionRow>(row);
}

export function deleteSession(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function deleteSessionsForUser(userId: string): void {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function getSettings(userId: string): UserSettingsRow | null {
  const row = getDb()
    .prepare(
      `SELECT user_id, email, plan, anthropic_key_enc, default_from, smtp_host, smtp_port,
              smtp_user, smtp_pass_enc, smtp_from_domain, operator_json, created_at, updated_at
       FROM user_settings WHERE user_id = ?`,
    )
    .get(userId);
  return plainOrNull<UserSettingsRow>(row);
}

export function patchSettings(
  userId: string,
  patch: Partial<Omit<UserSettingsRow, "user_id" | "created_at">>,
): void {
  const current = getSettings(userId);
  const ts = nowIso();
  if (!current) {
    getDb()
      .prepare(
        `INSERT INTO user_settings (user_id, email, plan, anthropic_key_enc, default_from, smtp_host, smtp_port,
           smtp_user, smtp_pass_enc, smtp_from_domain, operator_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userId,
        patch.email ?? null,
        patch.plan ?? "free",
        patch.anthropic_key_enc ?? null,
        patch.default_from ?? null,
        patch.smtp_host ?? null,
        patch.smtp_port ?? null,
        patch.smtp_user ?? null,
        patch.smtp_pass_enc ?? null,
        patch.smtp_from_domain ?? null,
        patch.operator_json ?? null,
        ts,
        ts,
      );
    return;
  }
  getDb()
    .prepare(
      `UPDATE user_settings SET
         email = ?, plan = ?, anthropic_key_enc = ?, default_from = ?, smtp_host = ?, smtp_port = ?,
         smtp_user = ?, smtp_pass_enc = ?, smtp_from_domain = ?, operator_json = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      patch.email !== undefined ? patch.email : current.email,
      patch.plan !== undefined ? patch.plan : current.plan,
      patch.anthropic_key_enc !== undefined ? patch.anthropic_key_enc : current.anthropic_key_enc,
      patch.default_from !== undefined ? patch.default_from : current.default_from,
      patch.smtp_host !== undefined ? patch.smtp_host : current.smtp_host,
      patch.smtp_port !== undefined ? patch.smtp_port : current.smtp_port,
      patch.smtp_user !== undefined ? patch.smtp_user : current.smtp_user,
      patch.smtp_pass_enc !== undefined ? patch.smtp_pass_enc : current.smtp_pass_enc,
      patch.smtp_from_domain !== undefined ? patch.smtp_from_domain : current.smtp_from_domain,
      patch.operator_json !== undefined ? patch.operator_json : current.operator_json,
      ts,
      userId,
    );
}

export function countUsers(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  return row.n;
}

/** Bytes of mail this account has caused to be stored (its sent log plus internal copies). */
export function getStoredBytes(userId: string): number {
  const row = getDb().prepare("SELECT stored_bytes AS n FROM user_settings WHERE user_id = ?").get(userId) as
    | { n: number }
    | undefined;
  return Number(row?.n ?? 0);
}

export function addStoredBytes(userId: string, bytes: number): void {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  getDb()
    .prepare("UPDATE user_settings SET stored_bytes = stored_bytes + ? WHERE user_id = ?")
    .run(Math.ceil(bytes), userId);
}

/* ───────────────────────── api keys ───────────────────────── */

export function insertApiKey(row: ApiKeyRow): void {
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, prefix, token_hash, scope, env, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.user_id,
      row.name,
      row.prefix,
      row.token_hash,
      row.scope,
      row.env,
      row.last_used_at,
      row.created_at,
    );
}

export function findApiKeyByHash(tokenHash: string): ApiKeyRow | null {
  const row = getDb()
    .prepare(
      `SELECT id, user_id, name, prefix, token_hash, scope, env, last_used_at, created_at
       FROM api_keys WHERE token_hash = ?`,
    )
    .get(tokenHash);
  return plainOrNull<ApiKeyRow>(row);
}

export function listApiKeysForUser(userId: string): ApiKeyRow[] {
  return getDb()
    .prepare(
      `SELECT id, user_id, name, prefix, token_hash, scope, env, last_used_at, created_at
       FROM api_keys WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(userId)
    .map((row) => plain<ApiKeyRow>(row));
}

export function deleteApiKeyForUser(userId: string, id: string): number {
  return getDb().prepare("DELETE FROM api_keys WHERE user_id = ? AND id = ?").run(userId, id).changes;
}

export function touchApiKey(id: string): void {
  getDb().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), id);
}

export function countApiKeysForUser(userId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?").get(userId) as { n: number };
  return row.n;
}

/* ───────────────────────── emails ───────────────────────── */

function mapEmail(row: Record<string, unknown>): EmailRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    api_key_id: (row.api_key_id as string) ?? null,
    from_addr: String(row.from_addr),
    to_addrs: jsonCol<string[]>(row.to_addrs, []),
    cc: jsonCol<string[] | null>(row.cc, null),
    bcc: jsonCol<string[] | null>(row.bcc, null),
    reply_to: (row.reply_to as string) ?? null,
    subject: String(row.subject),
    html: (row.html as string) ?? null,
    text: (row.text as string) ?? null,
    tags: jsonCol<EmailRow["tags"]>(row.tags, null),
    status: String(row.status),
    provider: String(row.provider),
    provider_message_id: (row.provider_message_id as string) ?? null,
    simulated: Boolean(row.simulated),
    error: (row.error as string) ?? null,
    source: row.source as EmailRow["source"],
    created_at: String(row.created_at),
  };
}

export function insertEmail(row: EmailRow): void {
  getDb()
    .prepare(
      `INSERT INTO emails (
         id, user_id, api_key_id, from_addr, to_addrs, cc, bcc, reply_to, subject, html, text, tags,
         status, provider, provider_message_id, simulated, error, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.user_id,
      row.api_key_id,
      row.from_addr,
      JSON.stringify(row.to_addrs),
      row.cc ? JSON.stringify(row.cc) : null,
      row.bcc ? JSON.stringify(row.bcc) : null,
      row.reply_to,
      row.subject,
      row.html,
      row.text,
      row.tags ? JSON.stringify(row.tags) : null,
      row.status,
      row.provider,
      row.provider_message_id,
      row.simulated ? 1 : 0,
      row.error,
      row.source,
      row.created_at,
    );
}

export function listEmailsForUser(userId: string, limit = 50): EmailRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM emails WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, Math.min(Math.max(limit, 1), 100)) as Record<string, unknown>[];
  return rows.map(mapEmail);
}

export function getEmailForUser(userId: string, id: string): EmailRow | null {
  const row = getDb().prepare("SELECT * FROM emails WHERE user_id = ? AND id = ?").get(userId, id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapEmail(row) : null;
}

export function countEmailsForUser(
  userId: string,
  opts?: { since?: string; simulated?: boolean },
): number {
  let sql = "SELECT COUNT(*) AS n FROM emails WHERE user_id = ?";
  const params: SqlValue[] = [userId];
  if (opts?.since) {
    sql += " AND created_at >= ?";
    params.push(opts.since);
  }
  if (opts?.simulated != null) {
    sql += " AND simulated = ?";
    params.push(opts.simulated ? 1 : 0);
  }
  const row = getDb().prepare(sql).get(...params) as { n: number };
  return row.n;
}

/* ───────────────────────── mailboxes ───────────────────────── */

export function insertMailbox(row: MailboxRow): void {
  getDb()
    .prepare("INSERT INTO mailboxes (id, user_id, address, display_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, row.user_id, row.address, row.display_name, row.created_at);
}

export function findMailboxByAddress(address: string): MailboxRow | null {
  const row = getDb()
    .prepare("SELECT id, user_id, address, display_name, created_at FROM mailboxes WHERE address = ?")
    .get(address.trim().toLowerCase());
  return plainOrNull<MailboxRow>(row);
}

export function listMailboxesForUser(userId: string): MailboxRow[] {
  return getDb()
    .prepare(
      "SELECT id, user_id, address, display_name, created_at FROM mailboxes WHERE user_id = ? ORDER BY created_at ASC",
    )
    .all(userId)
    .map((row) => plain<MailboxRow>(row));
}

export function countMailboxesForUser(userId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM mailboxes WHERE user_id = ?").get(userId) as { n: number };
  return row.n;
}

function mapMailboxMessage(row: Record<string, unknown>): MailboxMessageRow {
  return {
    id: String(row.id),
    mailbox_id: String(row.mailbox_id),
    user_id: String(row.user_id),
    email_id: (row.email_id as string) ?? null,
    from_addr: String(row.from_addr),
    from_name: (row.from_name as string) ?? null,
    to_addrs: jsonCol<string[]>(row.to_addrs, []),
    subject: String(row.subject),
    text: (row.text as string) ?? null,
    html: (row.html as string) ?? null,
    read: Boolean(row.read),
    created_at: String(row.created_at),
  };
}

export function insertMailboxMessage(row: MailboxMessageRow): void {
  getDb()
    .prepare(
      `INSERT INTO mailbox_messages (
         id, mailbox_id, user_id, email_id, from_addr, from_name, to_addrs, subject, text, html, read, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.mailbox_id,
      row.user_id,
      row.email_id,
      row.from_addr,
      row.from_name,
      JSON.stringify(row.to_addrs),
      row.subject,
      row.text,
      row.html,
      row.read ? 1 : 0,
      row.created_at,
    );
}

export function countMailboxMessagesForBox(mailboxId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE mailbox_id = ?").get(mailboxId) as {
    n: number;
  };
  return row.n;
}

/** Keep only the newest `keep` messages in a mailbox. Returns rows removed. */
export function trimMailboxMessages(mailboxId: string, keep: number): number {
  return Number(
    getDb()
      .prepare(
        `DELETE FROM mailbox_messages WHERE mailbox_id = ? AND id NOT IN (
           SELECT id FROM mailbox_messages WHERE mailbox_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(mailboxId, mailboxId, Math.max(0, keep)).changes,
  );
}

export function listMailboxMessagesForBox(
  mailboxId: string,
  opts?: { since?: string; unreadOnly?: boolean; limit?: number },
): MailboxMessageRow[] {
  let sql =
    "SELECT * FROM mailbox_messages WHERE mailbox_id = ?";
  const params: SqlValue[] = [mailboxId];
  if (opts?.since) {
    sql += " AND created_at > ?";
    params.push(opts.since);
  }
  if (opts?.unreadOnly) sql += " AND read = 0";
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(Math.min(Math.max(opts?.limit ?? 50, 1), 100));
  const rows = getDb().prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(mapMailboxMessage);
}

export function markMailboxMessagesReadForBox(mailboxId: string, ids: string[]): number {
  if (!ids.length) return 0;
  const slice = ids.slice(0, 100);
  const placeholders = slice.map(() => "?").join(",");
  const result = getDb()
    .prepare(`UPDATE mailbox_messages SET read = 1 WHERE mailbox_id = ? AND id IN (${placeholders})`)
    .run(mailboxId, ...slice);
  return result.changes;
}

/* ───────────────────────── domains ───────────────────────── */

function mapDomain(row: Record<string, unknown>): DomainRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    domain: String(row.domain),
    status: row.status as DomainRow["status"],
    region: String(row.region),
    records: jsonCol<DnsRecord[] | null>(row.records, null),
    verified_at: (row.verified_at as string) ?? null,
    created_at: String(row.created_at),
  };
}

export function listDomainsForUser(userId: string): DomainRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM domains WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Record<string, unknown>[];
  return rows.map(mapDomain);
}

export function getDomainForUser(userId: string, id: string): DomainRow | null {
  const row = getDb().prepare("SELECT * FROM domains WHERE user_id = ? AND id = ?").get(userId, id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapDomain(row) : null;
}

export function upsertDomain(row: DomainRow): void {
  getDb()
    .prepare(
      `INSERT INTO domains (id, user_id, domain, status, region, records, verified_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, domain) DO UPDATE SET
         status = excluded.status,
         region = excluded.region,
         records = excluded.records,
         verified_at = excluded.verified_at`,
    )
    .run(
      row.id,
      row.user_id,
      row.domain,
      row.status,
      row.region,
      row.records ? JSON.stringify(row.records) : null,
      row.verified_at,
      row.created_at,
    );
}

export function updateDomainStatus(id: string, status: string, verifiedAt: string | null): void {
  getDb().prepare("UPDATE domains SET status = ?, verified_at = ? WHERE id = ?").run(status, verifiedAt, id);
}

export function deleteDomainForUser(userId: string, id: string): number {
  return getDb().prepare("DELETE FROM domains WHERE user_id = ? AND id = ?").run(userId, id).changes;
}

export function countDomainsForUser(userId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM domains WHERE user_id = ?").get(userId) as { n: number };
  return row.n;
}

/* ───────────────────────── connected accounts ───────────────────────── */

function mapAccount(row: Record<string, unknown>): ConnectedAccountRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    provider: row.provider as ConnectedAccountRow["provider"],
    email: String(row.email),
    label: (row.label as string) ?? null,
    status: row.status as ConnectedAccountRow["status"],
    color: String(row.color),
    access_token_enc: (row.access_token_enc as string) ?? null,
    refresh_token_enc: (row.refresh_token_enc as string) ?? null,
    token_expires_at: (row.token_expires_at as string) ?? null,
    scopes: jsonCol<string[] | null>(row.scopes, null),
    sync_cursor: (row.sync_cursor as string) ?? null,
    last_sync_at: (row.last_sync_at as string) ?? null,
    created_at: String(row.created_at),
  };
}

export function listConnectedAccounts(userId: string): ConnectedAccountRow[] {
  const rows = getDb()
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as Record<string, unknown>[];
  return rows.map(mapAccount);
}

export function getConnectedAccount(userId: string, accountId: string): ConnectedAccountRow | null {
  const row = getDb()
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND id = ?")
    .get(userId, accountId) as Record<string, unknown> | undefined;
  return row ? mapAccount(row) : null;
}

export function findConnectedAccount(
  userId: string,
  provider: string,
  email: string,
): ConnectedAccountRow | null {
  const row = getDb()
    .prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ? AND email = ?")
    .get(userId, provider, email) as Record<string, unknown> | undefined;
  return row ? mapAccount(row) : null;
}

export function insertConnectedAccount(row: ConnectedAccountRow): void {
  getDb()
    .prepare(
      `INSERT INTO connected_accounts (
         id, user_id, provider, email, label, status, color, access_token_enc, refresh_token_enc,
         token_expires_at, scopes, sync_cursor, last_sync_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.user_id,
      row.provider,
      row.email,
      row.label,
      row.status,
      row.color,
      row.access_token_enc,
      row.refresh_token_enc,
      row.token_expires_at,
      row.scopes ? JSON.stringify(row.scopes) : null,
      row.sync_cursor,
      row.last_sync_at,
      row.created_at,
    );
}

export function updateConnectedAccount(
  id: string,
  patch: Partial<
    Pick<
      ConnectedAccountRow,
      | "status"
      | "access_token_enc"
      | "refresh_token_enc"
      | "token_expires_at"
      | "scopes"
      | "sync_cursor"
      | "last_sync_at"
      | "email"
      | "label"
    >
  >,
): void {
  const current = getDb().prepare("SELECT * FROM connected_accounts WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!current) return;
  const next = { ...mapAccount(current), ...patch };
  getDb()
    .prepare(
      `UPDATE connected_accounts SET
         status = ?, access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ?,
         scopes = ?, sync_cursor = ?, last_sync_at = ?, email = ?, label = ?
       WHERE id = ?`,
    )
    .run(
      next.status,
      next.access_token_enc,
      next.refresh_token_enc,
      next.token_expires_at,
      next.scopes ? JSON.stringify(next.scopes) : null,
      next.sync_cursor,
      next.last_sync_at,
      next.email,
      next.label,
      id,
    );
}

export function deleteConnectedAccount(userId: string, accountId: string): void {
  getDb().prepare("DELETE FROM connected_accounts WHERE user_id = ? AND id = ?").run(userId, accountId);
}

export function countConnectedAccounts(userId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM connected_accounts WHERE user_id = ?")
    .get(userId) as { n: number };
  return row.n;
}

/* ───────────────────────── thread_ai ───────────────────────── */

export function listThreadAiForAccounts(accountIds: string[]): ThreadAiRow[] {
  if (!accountIds.length) return [];
  const placeholders = accountIds.map(() => "?").join(",");
  const rows = getDb()
    .prepare(
      `SELECT account_id, provider_thread_id, labels, summary, updated_at
       FROM thread_ai WHERE account_id IN (${placeholders})`,
    )
    .all(...accountIds) as Record<string, unknown>[];
  return rows.map((row) => ({
    account_id: String(row.account_id),
    provider_thread_id: String(row.provider_thread_id),
    labels: jsonCol<string[]>(row.labels, []),
    summary: (row.summary as string) ?? null,
    updated_at: String(row.updated_at),
  }));
}

export function upsertThreadAi(row: ThreadAiRow): void {
  getDb()
    .prepare(
      `INSERT INTO thread_ai (account_id, provider_thread_id, labels, summary, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, provider_thread_id) DO UPDATE SET
         labels = excluded.labels, summary = excluded.summary, updated_at = excluded.updated_at`,
    )
    .run(row.account_id, row.provider_thread_id, JSON.stringify(row.labels), row.summary, row.updated_at);
}

export function deleteThreadAiForAccount(accountId: string): void {
  getDb().prepare("DELETE FROM thread_ai WHERE account_id = ?").run(accountId);
}
