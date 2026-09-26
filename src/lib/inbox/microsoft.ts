/**
 * Outlook / Microsoft 365 provider — Microsoft Graph + Microsoft identity
 * platform (v2.0) OAuth, all via `fetch` (no SDK dependency). Server-only.
 *
 * Mirrors the function shapes in google.ts so service.ts can treat providers
 * uniformly. Degrades gracefully when MICROSOFT_CLIENT_ID / _SECRET are absent.
 */

import type { MailMessage, MailThread } from "./types";

const TENANT = "common";
const OAUTH_AUTH = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const OAUTH_TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export const MICROSOFT_SCOPES = ["offline_access", "Mail.Read", "User.Read"];

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function microsoftAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

interface MsTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export async function exchangeMicrosoftCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string | null; expires_in: number; email: string }> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });
  const json = (await res.json()) as MsTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Microsoft token exchange failed.");
  }
  const email = await fetchMicrosoftEmail(json.access_token);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_in: json.expires_in ?? 3600,
    email,
  };
}

async function fetchMicrosoftEmail(accessToken: string): Promise<string> {
  const res = await fetch(`${GRAPH_BASE}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Failed to read Microsoft account email.");
  const json = (await res.json()) as { mail?: string; userPrincipalName?: string };
  const email = json.mail || json.userPrincipalName;
  if (!email) throw new Error("Microsoft account has no email.");
  return email;
}

export async function refreshMicrosoftToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.MICROSOFT_CLIENT_ID ?? "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });
  const json = (await res.json()) as MsTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Microsoft token refresh failed.");
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600 };
}

/* ── Graph message shapes (partial) ── */

interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  isRead?: boolean;
  receivedDateTime?: string;
  sentDateTime?: string;
  internetMessageId?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  body?: { contentType?: string; content?: string };
}

async function graphFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph API ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * List recent "threads" — Graph has no thread endpoint, so we group inbox
 * messages by conversationId and treat each conversation as a thread.
 */
export async function listGraphThreads(
  accessToken: string,
  opts?: { q?: string; max?: number },
): Promise<{ id: string; snippet: string }[]> {
  const max = opts?.max ?? 25;
  const params = new URLSearchParams({
    $top: String(max * 2),
    $orderby: "receivedDateTime desc",
    $select: "id,conversationId,bodyPreview,receivedDateTime",
  });
  if (opts?.q) params.set("$search", `"${opts.q}"`);
  // $search and $orderby can't be combined on Graph; drop ordering when searching.
  if (opts?.q) params.delete("$orderby");

  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/mailFolders/inbox/messages?${params.toString()}`,
  );
  const seen = new Set<string>();
  const out: { id: string; snippet: string }[] = [];
  for (const m of data.value ?? []) {
    const convId = m.conversationId ?? m.id;
    if (seen.has(convId)) continue;
    seen.add(convId);
    out.push({ id: convId, snippet: m.bodyPreview ?? "" });
    if (out.length >= max) break;
  }
  return out;
}

/** Fetch all messages of a conversation and map them into a MailThread. */
export async function getGraphThread(accessToken: string, conversationId: string): Promise<MailThread> {
  const filter = encodeURIComponent(`conversationId eq '${conversationId}'`);
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?$filter=${filter}&$top=50&$select=id,conversationId,subject,bodyPreview,isRead,receivedDateTime,sentDateTime,internetMessageId,from,toRecipients,body`,
  );
  const raw = (data.value ?? []).slice().sort((a, b) => msgTime(a) - msgTime(b));
  const messages = raw.map(mapGraphMessage);
  const last = raw[raw.length - 1];
  const subject = last?.subject || raw[0]?.subject || "(no subject)";
  const unread = raw.some((m) => m.isRead === false);
  const participants = dedupeParticipants(messages);

  return {
    id: conversationId,
    accountId: "",
    subject,
    participants,
    messages,
    unread,
    labels: [],
    snippet: last?.bodyPreview || messages[messages.length - 1]?.bodyText.slice(0, 140) || "",
  };
}

function msgTime(m: GraphMessage): number {
  const d = m.receivedDateTime || m.sentDateTime;
  return d ? new Date(d).getTime() : 0;
}

function mapGraphMessage(m: GraphMessage): MailMessage {
  const from = {
    name: m.from?.emailAddress?.name || undefined,
    email: m.from?.emailAddress?.address || "",
  };
  const to = (m.toRecipients ?? []).map((r) => r.emailAddress?.address || "").filter(Boolean);
  const content = m.body?.content ?? "";
  const isHtml = (m.body?.contentType ?? "").toLowerCase() === "html";
  const html = isHtml ? content : "";
  const text = isHtml ? stripHtml(content) : content || m.bodyPreview || "";
  return {
    id: m.id,
    from,
    to,
    date: (m.receivedDateTime || m.sentDateTime || new Date().toISOString()) as string,
    bodyText: text,
    bodyHtml: html || undefined,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|br|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function dedupeParticipants(messages: MailMessage[]): { name?: string; email: string }[] {
  const seen = new Map<string, { name?: string; email: string }>();
  for (const m of messages) {
    if (m.from.email && !seen.has(m.from.email)) seen.set(m.from.email, m.from);
  }
  return Array.from(seen.values());
}
