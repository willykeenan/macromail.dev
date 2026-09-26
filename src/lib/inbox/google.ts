/**
 * Gmail provider — talks to the Gmail REST API + Google OAuth2 directly with
 * `fetch` (no googleapis dependency). All functions are server-only.
 *
 * Everything degrades gracefully when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 * are absent: googleConfigured() returns false and the UI shows an honest
 * "ask your admin" hint instead of a dead OAuth button.
 */

import type { MailMessage, MailThread } from "./types";

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
  "email",
];

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Build the OAuth2 consent URL. `state` carries our signed user/provider blob. */
export function googleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/** Exchange an auth code for tokens, then fetch the account's email address. */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string | null; expires_in: number; email: string }> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google token exchange failed.");
  }
  const email = await fetchGoogleEmail(json.access_token);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_in: json.expires_in ?? 3600,
    email,
  };
}

async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error("Failed to read Google account email.");
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("Google account has no email.");
  return json.email;
}

/** Refresh an access token using the stored refresh token. */
export async function refreshGoogleToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as GoogleTokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google token refresh failed.");
  }
  return { access_token: json.access_token, expires_in: json.expires_in ?? 3600 };
}

/* ── Gmail message/thread types (partial, only what we read) ── */

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}
interface GmailThreadResponse {
  id: string;
  snippet?: string;
  messages?: GmailMessage[];
}

async function gmailFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gmail API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** List recent thread ids (newest first). */
export async function listGmailThreads(
  accessToken: string,
  opts?: { q?: string; max?: number },
): Promise<{ id: string; snippet: string }[]> {
  const params = new URLSearchParams({ maxResults: String(opts?.max ?? 25) });
  if (opts?.q) params.set("q", opts.q);
  const data = await gmailFetch<{ threads?: { id: string; snippet?: string }[] }>(
    accessToken,
    `/threads?${params.toString()}`,
  );
  return (data.threads ?? []).map((t) => ({ id: t.id, snippet: t.snippet ?? "" }));
}

/** Fetch a full thread and map it into a (provider-thread-id-keyed) MailThread. */
export async function getGmailThread(accessToken: string, threadId: string): Promise<MailThread> {
  const data = await gmailFetch<GmailThreadResponse>(accessToken, `/threads/${threadId}?format=full`);
  const messages = (data.messages ?? []).map(mapGmailMessage);
  const last = messages[messages.length - 1];
  const subject = headerOf(data.messages?.[data.messages.length - 1]?.payload, "Subject") || "(no subject)";
  const unread = (data.messages ?? []).some((m) => (m.labelIds ?? []).includes("UNREAD"));

  const participants = dedupeParticipants(messages);

  return {
    // accountId + composite id are filled in by service.ts; provider thread id here.
    id: threadId,
    accountId: "",
    subject,
    participants,
    messages,
    unread,
    labels: [],
    snippet: data.snippet || last?.bodyText.slice(0, 140) || "",
  };
}

function mapGmailMessage(m: GmailMessage): MailMessage {
  const from = parseAddress(headerOf(m.payload, "From"));
  const to = parseAddressList(headerOf(m.payload, "To"));
  const dateHeader = headerOf(m.payload, "Date");
  const date = dateHeader
    ? new Date(dateHeader).toISOString()
    : m.internalDate
      ? new Date(Number(m.internalDate)).toISOString()
      : new Date().toISOString();
  const { text, html } = extractBody(m.payload);
  return {
    id: m.id,
    from,
    to: to.map((a) => a.email),
    date,
    bodyText: text || m.snippet || "",
    bodyHtml: html || undefined,
  };
}

function headerOf(payload: GmailPart | undefined, name: string): string {
  const h = payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

/** Walk the MIME tree; prefer text/plain, fall back to stripped HTML. */
function extractBody(payload: GmailPart | undefined): { text: string; html: string } {
  let text = "";
  let html = "";
  function walk(part?: GmailPart) {
    if (!part) return;
    const mime = part.mimeType ?? "";
    if (mime === "text/plain" && part.body?.data && !text) {
      text = decodeBase64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    for (const p of part.parts ?? []) walk(p);
  }
  walk(payload);
  if (!text && html) text = stripHtml(html);
  return { text, html };
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
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

function parseAddress(raw: string): { name?: string; email: string } {
  const trimmed = (raw || "").trim();
  const match = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    return { name: name || undefined, email: match[2].trim() };
  }
  return { email: trimmed };
}

function parseAddressList(raw: string): { name?: string; email: string }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseAddress(s))
    .filter((a) => a.email);
}

function dedupeParticipants(messages: MailMessage[]): { name?: string; email: string }[] {
  const seen = new Map<string, { name?: string; email: string }>();
  for (const m of messages) {
    if (m.from.email && !seen.has(m.from.email)) seen.set(m.from.email, m.from);
  }
  return Array.from(seen.values());
}
