"use server";

import { getCurrentUser, requireMutationOrigin } from "@/lib/auth";
import { createApiKey, listApiKeys as listStoredApiKeys, revokeApiKey } from "@/lib/api-keys";
import { countApiKeysForUser } from "@/lib/db";
import { MAX_API_KEYS_PER_USER } from "@/lib/limits";
import type { KeyEnv, KeyScope } from "@/lib/types/db";

export interface KeyListItem {
  id: string;
  name: string;
  prefix: string;
  scope: KeyScope;
  env: KeyEnv;
  last_used_at: string | null;
  created_at: string;
}

export async function listApiKeys(): Promise<KeyListItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listStoredApiKeys(user.id).map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scope: k.scope,
    env: k.env,
    last_used_at: k.last_used_at,
    created_at: k.created_at,
  }));
}

export type CreateKeyResult =
  | { error: string }
  | { token: string; row: { id: string; name: string; prefix: string; scope: KeyScope; env: KeyEnv; created_at: string } };

export async function createApiKeyAction(input: {
  name: string;
  scope: KeyScope;
  env: KeyEnv;
}): Promise<CreateKeyResult> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const scope: KeyScope = input.scope === "sending_only" ? "sending_only" : "full_access";
  const env: KeyEnv = input.env === "test" ? "test" : "live";
  const name = String(input.name ?? "").trim().slice(0, 100);
  if (countApiKeysForUser(user.id) >= MAX_API_KEYS_PER_USER) {
    return { error: `An account can have at most ${MAX_API_KEYS_PER_USER} API keys. Revoke one first.` };
  }
  try {
    const { row, token } = await createApiKey({ userId: user.id, name, scope, env });
    return { token, row };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create key." };
  }
}

export async function revokeApiKeyAction(id: string): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  revokeApiKey(user.id, String(id ?? ""));
  return { ok: true };
}
