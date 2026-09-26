import { id, apiToken } from "@/lib/ids";
import { sha256 } from "@/lib/crypto";
import {
  deleteApiKeyForUser,
  findApiKeyByHash,
  insertApiKey,
  listApiKeysForUser,
  touchApiKey,
} from "@/lib/db";
import type { ApiKeyRow, KeyEnv, KeyScope } from "@/lib/types/db";

/** A full API token: mm_live_<32> / mm_test_<32>. Shown to the user exactly once. */
export function generateToken(env: KeyEnv): string {
  return apiToken(env);
}

/** Short, safe display prefix for a token (first 12 chars + ellipsis). */
export function tokenPrefix(token: string): string {
  return `${token.slice(0, 12)}…`;
}

export interface CreatedKey {
  row: Pick<ApiKeyRow, "id" | "name" | "prefix" | "scope" | "env" | "created_at">;
  token: string; // plaintext — return to caller once, never stored
}

/** Create + persist a new API key for a user. Returns the plaintext token once. */
export async function createApiKey(opts: {
  userId: string;
  name: string;
  scope: KeyScope;
  env: KeyEnv;
}): Promise<CreatedKey> {
  const token = generateToken(opts.env);
  const row: ApiKeyRow = {
    id: id("key"),
    user_id: opts.userId,
    name: opts.name.trim() || "Untitled key",
    prefix: tokenPrefix(token),
    token_hash: sha256(token),
    scope: opts.scope,
    env: opts.env,
    last_used_at: null,
    created_at: new Date().toISOString(),
  };
  insertApiKey(row);
  return {
    row: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scope: row.scope,
      env: row.env,
      created_at: row.created_at,
    },
    token,
  };
}

export function listApiKeys(userId: string): ApiKeyRow[] {
  return listApiKeysForUser(userId);
}

export function revokeApiKey(userId: string, keyId: string): boolean {
  return deleteApiKeyForUser(userId, keyId) > 0;
}

export interface AuthedKey {
  keyId: string;
  userId: string;
  scope: KeyScope;
  env: KeyEnv;
}

/** Extract a bearer token from an Authorization header (or x-api-key). */
export function bearerFrom(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x?.trim() || null;
}

/**
 * Authenticate a request by its API key. Looks the token up by hash, so we never
 * store or compare plaintext. Updates last_used_at (best effort). Returns null
 * when the key is missing/invalid.
 */
export async function authenticateKey(req: Request): Promise<AuthedKey | null> {
  const token = bearerFrom(req);
  if (!token || !token.startsWith("mm_")) return null;

  const data = findApiKeyByHash(sha256(token));
  if (!data) return null;

  try {
    touchApiKey(data.id);
  } catch {
    /* best-effort */
  }

  return {
    keyId: data.id,
    userId: data.user_id,
    scope: data.scope,
    env: data.env,
  };
}

/** Standard 401 body for missing/invalid keys (Resend-style shape). */
export function authErrorBody() {
  return {
    error: {
      code: "authentication_error",
      message: "Missing or invalid API key.",
      fix: "Create a key in the dashboard (API keys) and send it as `Authorization: Bearer mm_live_…`.",
    },
  };
}
