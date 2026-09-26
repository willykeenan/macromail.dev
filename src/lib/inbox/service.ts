/**
 * Inbox aggregation layer — the single server-only surface the dashboard AND the
 * MCP server depend on. Talks to providers (google.ts / microsoft.ts), persists
 * tokens + AI labels in SQLite, and degrades honestly when AI is off.
 *
 * EXPORTED CONTRACT (do not change signatures without updating the MCP server):
 *   listAccounts, getValidAccessToken, listThreads, getThread, triageThreads,
 *   draftReply, disconnectAccount. Connected accounts are read-only: there is no send.
 *
 * Server-only — never import this module into a Client Component.
 */

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  deleteConnectedAccount,
  deleteThreadAiForAccount,
  getConnectedAccount,
  getSettings,
  listConnectedAccounts,
  listThreadAiForAccounts,
  updateConnectedAccount,
  upsertThreadAi,
} from "@/lib/db";
import {
  runAI,
  AI_MODELS,
  aiEnabled,
  extractJson,
  renderThread,
  AiDisabledError,
} from "@/lib/ai";
import type { ConnectedAccountRow } from "@/lib/types/db";
import type { AiLabel, MailThread } from "./types";
import {
  getGmailThread,
  listGmailThreads,
  refreshGoogleToken,
} from "./google";
import {
  getGraphThread,
  listGraphThreads,
  refreshMicrosoftToken,
} from "./microsoft";

const VALID_LABELS: AiLabel[] = ["important", "newsletter", "action_needed", "fyi", "promotions"];

/* ────────────────────────────────────────────────────────────────────────── */
/* Accounts                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** All connected accounts for a user (newest first). Empty array on any failure. */
export async function listAccounts(userId: string): Promise<ConnectedAccountRow[]> {
  try {
    return listConnectedAccounts(userId);
  } catch {
    return [];
  }
}

async function getAccount(userId: string, accountId: string): Promise<ConnectedAccountRow | null> {
  return getConnectedAccount(userId, accountId);
}

/**
 * Decrypt the account's access token; if it's expired (or near expiry), refresh
 * via the provider, persist the new encrypted token + expiry, and return it.
 * Returns null when the account can't produce a usable token.
 */
export async function getValidAccessToken(account: ConnectedAccountRow): Promise<string | null> {
  const access = decryptSecret(account.access_token_enc);
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const stillFresh = access && expiresAt - Date.now() > 60_000; // 60s safety margin
  if (stillFresh) return access;

  const refresh = decryptSecret(account.refresh_token_enc);
  if (!refresh) return access; // no refresh token — return whatever we have (may be null)

  try {
    const refreshed =
      account.provider === "gmail"
        ? await refreshGoogleToken(refresh)
        : account.provider === "outlook"
          ? await refreshMicrosoftToken(refresh)
          : null;
    if (!refreshed) return access;

    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    updateConnectedAccount(account.id, {
      access_token_enc: encryptSecret(refreshed.access_token),
      token_expires_at: newExpiry,
      status: "connected",
    });
    return refreshed.access_token;
  } catch {
    try {
      updateConnectedAccount(account.id, { status: "needs_auth" });
    } catch {
      /* */
    }
    return access;
  }
}

export async function disconnectAccount(userId: string, accountId: string): Promise<void> {
  deleteConnectedAccount(userId, accountId);
  deleteThreadAiForAccount(accountId);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Composite thread ids: `${accountId}::${providerThreadId}`                     */
/* ────────────────────────────────────────────────────────────────────────── */

function compositeId(accountId: string, providerThreadId: string): string {
  return `${accountId}::${providerThreadId}`;
}
function splitComposite(id: string): { accountId: string; providerThreadId: string } | null {
  const idx = id.indexOf("::");
  if (idx < 0) return null;
  return { accountId: id.slice(0, idx), providerThreadId: id.slice(idx + 2) };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Threads                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

async function listAccountThreads(
  account: ConnectedAccountRow,
  opts: { query?: string; limit: number },
): Promise<MailThread[]> {
  const token = await getValidAccessToken(account);
  if (!token) return [];

  try {
    if (account.provider === "gmail") {
      const stubs = await listGmailThreads(token, { q: opts.query, max: opts.limit });
      const full = await Promise.all(
        stubs.map((s) =>
          getGmailThread(token, s.id).catch(() => null),
        ),
      );
      return full.filter((t): t is MailThread => Boolean(t)).map((t) => decorate(account, t));
    }
    if (account.provider === "outlook") {
      const stubs = await listGraphThreads(token, { q: opts.query, max: opts.limit });
      const full = await Promise.all(
        stubs.map((s) =>
          getGraphThread(token, s.id).catch(() => null),
        ),
      );
      return full.filter((t): t is MailThread => Boolean(t)).map((t) => decorate(account, t));
    }
    return [];
  } catch {
    return [];
  }
}

/** Set accountId + composite id + account color carrier onto a provider thread. */
function decorate(account: ConnectedAccountRow, thread: MailThread): MailThread {
  return {
    ...thread,
    accountId: account.id,
    id: compositeId(account.id, thread.id),
  };
}

/**
 * Aggregate threads across the user's connected accounts (or one, when accountId
 * is given). Sorted by latest message date desc, with persisted AI labels merged.
 */
export async function listThreads(
  userId: string,
  opts?: { accountId?: string; query?: string; limit?: number },
): Promise<MailThread[]> {
  const limit = opts?.limit ?? 25;
  const accounts = await listAccounts(userId);
  const targets = opts?.accountId ? accounts.filter((a) => a.id === opts.accountId) : accounts;
  if (targets.length === 0) return [];

  const perAccount = await Promise.all(
    targets.map((a) => listAccountThreads(a, { query: opts?.query, limit })),
  );
  const threads = perAccount.flat();

  await attachPersistedLabels(threads);

  threads.sort((a, b) => latestDate(b) - latestDate(a));
  return threads.slice(0, opts?.accountId ? limit : limit * Math.max(1, targets.length));
}

function latestDate(thread: MailThread): number {
  const last = thread.messages[thread.messages.length - 1];
  return last ? new Date(last.date).getTime() : 0;
}

/** Merge any stored thread_ai labels/summary onto the in-memory threads. */
async function attachPersistedLabels(threads: MailThread[]): Promise<void> {
  if (threads.length === 0) return;
  const accountIds = Array.from(new Set(threads.map((t) => t.accountId)));
  const data = listThreadAiForAccounts(accountIds);
  const map = new Map<string, { labels: string[]; summary: string | null }>();
  for (const row of data) {
    map.set(`${row.account_id}::${row.provider_thread_id}`, {
      labels: row.labels ?? [],
      summary: row.summary,
    });
  }
  for (const t of threads) {
    const hit = map.get(t.id);
    if (hit) t.labels = hit.labels.filter((l): l is AiLabel => (VALID_LABELS as string[]).includes(l));
  }
}

/** Fetch one full thread, verifying account ownership. */
export async function getThread(userId: string, compositeIdStr: string): Promise<MailThread | null> {
  const parts = splitComposite(compositeIdStr);
  if (!parts) return null;
  const account = await getAccount(userId, parts.accountId);
  if (!account) return null;
  const token = await getValidAccessToken(account);
  if (!token) return null;

  try {
    const thread =
      account.provider === "gmail"
        ? await getGmailThread(token, parts.providerThreadId)
        : account.provider === "outlook"
          ? await getGraphThread(token, parts.providerThreadId)
          : null;
    if (!thread) return null;
    const decorated = decorate(account, thread);
    await attachPersistedLabels([decorated]);
    return decorated;
  } catch {
    return null;
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* BYOK Anthropic key                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/** Read the user's stored (encrypted) Anthropic key, or a per-request override. */
export async function resolveUserAnthropicKey(
  userId: string,
  override?: string | null,
): Promise<string | null> {
  if (override?.trim()) return override.trim();
  try {
    const settings = getSettings(userId);
    const stored = decryptSecret(settings?.anthropic_key_enc);
    if (stored) return stored;
  } catch {
    /* no stored key */
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* AI: triage + draft                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Classify threads into AI labels + a one-line summary in a single batched call.
 * Persists results to thread_ai (upsert). Returns {} when AI is disabled — never
 * fabricates labels.
 */
export async function triageThreads(
  userId: string,
  threads: MailThread[],
  anthropicKey?: string | null,
): Promise<Record<string, { labels: AiLabel[]; summary: string }>> {
  if (!aiEnabled(anthropicKey) || threads.length === 0) return {};

  const list = threads
    .map((t, i) => {
      const from = t.participants[0]?.name || t.participants[0]?.email || "unknown";
      return `- idx:${i} | from:${from} | subject:${t.subject} | ${t.snippet}`;
    })
    .join("\n");

  let out: string;
  try {
    out = await runAI({
      apiKey: anthropicKey,
      model: AI_MODELS.fast,
      maxTokens: 1500,
      temperature: 0.2,
      system:
        "You triage an email inbox. For EACH item assign 1-2 labels from " +
        '["important","action_needed","newsletter","promotions","fyi"] and a one-line summary (<= 14 words). ' +
        'Return STRICT JSON: {"results": [{"idx": number, "labels": string[], "summary": string}]}. No prose outside JSON.',
      prompt: list,
    });
  } catch (e) {
    if (e instanceof AiDisabledError) return {};
    throw e;
  }

  const parsed = extractJson<{ results: { idx: number; labels: string[]; summary: string }[] }>(out);
  if (!parsed?.results) return {};

  const result: Record<string, { labels: AiLabel[]; summary: string }> = {};
  const rows: { account_id: string; provider_thread_id: string; labels: string[]; summary: string; updated_at: string }[] = [];
  const now = new Date().toISOString();

  for (const r of parsed.results) {
    const thread = threads[r.idx];
    if (!thread) continue;
    const labels = (r.labels ?? []).filter((l): l is AiLabel => (VALID_LABELS as string[]).includes(l));
    const summary = (r.summary ?? "").trim();
    result[thread.id] = { labels, summary };
    thread.labels = labels;

    const parts = splitComposite(thread.id);
    if (parts) {
      rows.push({
        account_id: parts.accountId,
        provider_thread_id: parts.providerThreadId,
        labels,
        summary,
        updated_at: now,
      });
    }
  }

  for (const row of rows) {
    try {
      upsertThreadAi(row);
    } catch {
      /* */
    }
  }

  return result;
}

/** Draft a reply to a thread using its full context. Throws if AI is disabled. */
export async function draftReply(
  userId: string,
  compositeIdStr: string,
  instructions: string | undefined,
  anthropicKey?: string | null,
): Promise<string> {
  if (!aiEnabled(anthropicKey)) throw new AiDisabledError();
  const thread = await getThread(userId, compositeIdStr);
  if (!thread) throw new Error("Thread not found.");

  const context = renderThread({ subject: thread.subject, messages: thread.messages });
  const guidance = instructions?.trim()
    ? `Write the reply following these instructions: ${instructions.trim()}`
    : "Write a helpful, appropriately-toned reply to the latest message.";

  return runAI({
    apiKey: anthropicKey,
    model: AI_MODELS.smart,
    maxTokens: 900,
    temperature: 0.5,
    system:
      "You draft email replies for a busy professional. Output ONLY the reply body — " +
      "no subject line, no preamble, no quoting the original. Match the thread's tone.",
    prompt: `${context}\n\n---\n${guidance}`,
  });
}
