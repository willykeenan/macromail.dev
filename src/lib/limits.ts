/**
 * Resource limits for a MacroMail server. They keep one account (or one
 * anonymous client) from filling the owner's disk, memory, or SMTP reputation.
 * Operators can raise the account-level caps with env vars.
 */

function envInt(name: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Largest JSON body accepted by REST, MCP, and dashboard API routes. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
/** POST /api/v1/emails/batch carries up to 100 messages. */
export const MAX_BATCH_BODY_BYTES = 4 * 1024 * 1024;
/** JSON-RPC requests per MCP batch. */
export const MAX_MCP_BATCH = 20;

/** Per-field caps on a send request. */
export const MAX_BODY_CHARS = 256 * 1024;
export const MAX_RECIPIENTS = 50;
export const MAX_TAGS = 10;
export const MAX_TAG_NAME = 64;
export const MAX_TAG_VALUE = 256;
export const MAX_ADDRESS_LENGTH = 320;
export const MAX_DISPLAY_NAME = 100;

/** Per-account caps. */
export const MAX_MAILBOXES_PER_USER = 20;
export const MAX_DOMAINS_PER_USER = 20;
export const MAX_API_KEYS_PER_USER = 25;
/** Each mailbox keeps its newest messages up to this count. */
export const MAX_MESSAGES_PER_MAILBOX = 2000;
/** Fixed overhead charged per stored message on top of its body bytes. */
export const STORED_MESSAGE_OVERHEAD_BYTES = 512;

export function maxStoredBytesPerUser(env: NodeJS.ProcessEnv = process.env): number {
  return envInt("MACROMAIL_USER_STORAGE_MB", 100, env) * 1024 * 1024;
}

/** Total accounts this server accepts. */
export function maxUsers(env: NodeJS.ProcessEnv = process.env): number {
  return envInt("MACROMAIL_MAX_USERS", 500, env);
}

/** Bytes a stored message costs toward the account's storage quota. */
export function storedMessageBytes(parts: {
  subject?: string | null;
  text?: string | null;
  html?: string | null;
}): number {
  return (
    Buffer.byteLength(parts.subject ?? "", "utf8") +
    Buffer.byteLength(parts.text ?? "", "utf8") +
    Buffer.byteLength(parts.html ?? "", "utf8") +
    STORED_MESSAGE_OVERHEAD_BYTES
  );
}
