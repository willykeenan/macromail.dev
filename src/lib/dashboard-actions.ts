"use server";

import {
  changeUserPassword,
  currentClientIp,
  getCurrentUser,
  requireMutationOrigin,
  setSessionCookieForUser,
} from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  countApiKeysForUser,
  countConnectedAccounts,
  countEmailsForUser,
  getSettings,
  listEmailsForUser,
  patchSettings,
} from "@/lib/db";
import { normalizeSend, sendSchema } from "@/lib/email/schema";
import { sendAndLog } from "@/lib/email/send";
import { publicSmtpError, testSmtpAuth } from "@/lib/email/smtp";
import {
  createMailbox,
  findDeliverableMailbox,
  INBOUND_NOTE,
  listMailboxMessages,
  listMailboxes,
  mailboxDomains,
  markMailboxMessagesRead,
  parseAddress,
} from "@/lib/mailboxes";
import { smtpSaveRateLimit, smtpTestRateLimit } from "@/lib/rate-limit";
import { assertSafeSmtpHost, ALLOWED_SMTP_PORTS, ALLOWED_SMTP_PORTS_TEXT } from "@/lib/smtp-guard";
import { resolveSmtpPasswordSource } from "@/lib/smtp-settings";
import type { MailboxMessageRow, MailboxRow } from "@/lib/types/db";

export interface OverviewStats {
  sent7d: number;
  sentTotal: number;
  keys: number;
  mailboxes: number;
  unread: number;
  accounts: number;
  hasSmtp: boolean;
  hasAiKey: boolean;
  signedIn: boolean;
}

export async function getOverviewStats(): Promise<OverviewStats> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      sent7d: 0,
      sentTotal: 0,
      keys: 0,
      mailboxes: 0,
      unread: 0,
      accounts: 0,
      hasSmtp: false,
      hasAiKey: false,
      signedIn: false,
    };
  }
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const boxes = await listMailboxes(user.id);
  let unread = 0;
  for (const box of boxes) {
    const result = await listMailboxMessages(user.id, box.address, { unreadOnly: true, limit: 100 });
    unread += result.messages?.length ?? 0;
  }
  const settings = getSettings(user.id);
  return {
    sentTotal: countEmailsForUser(user.id),
    sent7d: countEmailsForUser(user.id, { since }),
    keys: countApiKeysForUser(user.id),
    mailboxes: boxes.length,
    unread,
    accounts: countConnectedAccounts(user.id),
    hasSmtp: Boolean(settings?.smtp_host && settings.smtp_user && settings.smtp_pass_enc),
    hasAiKey: Boolean(settings?.anthropic_key_enc),
    signedIn: true,
  };
}

export interface EmailListItem {
  id: string;
  from_addr: string;
  to_addrs: string[];
  subject: string;
  status: string;
  simulated: boolean;
  provider: string;
  source: string;
  created_at: string;
  error: string | null;
}

export async function listEmails(limit = 100): Promise<EmailListItem[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listEmailsForUser(user.id, limit).map((e) => ({
    id: e.id,
    from_addr: e.from_addr,
    to_addrs: e.to_addrs,
    subject: e.subject,
    status: e.status,
    simulated: e.simulated,
    provider: e.provider,
    source: e.source,
    created_at: e.created_at,
    error: e.error,
  }));
}

export interface ProfileSettings {
  hasAiKey: boolean;
  default_from: string | null;
  email: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_from_domain: string | null;
  hasSmtpPass: boolean;
  hasSmtp: boolean;
}

export async function getProfileSettings(): Promise<ProfileSettings> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      hasAiKey: false,
      default_from: null,
      email: null,
      smtp_host: null,
      smtp_port: null,
      smtp_user: null,
      smtp_from_domain: null,
      hasSmtpPass: false,
      hasSmtp: false,
    };
  }
  const data = getSettings(user.id);
  const hasSmtpPass = Boolean(data?.smtp_pass_enc);
  return {
    hasAiKey: Boolean(data?.anthropic_key_enc),
    default_from: data?.default_from ?? null,
    email: data?.email ?? user.email ?? null,
    smtp_host: data?.smtp_host ?? null,
    smtp_port: data?.smtp_port ?? null,
    smtp_user: data?.smtp_user ?? null,
    smtp_from_domain: data?.smtp_from_domain ?? null,
    hasSmtpPass,
    hasSmtp: Boolean(data?.smtp_host && data.smtp_user && hasSmtpPass),
  };
}

export async function saveAiKeyAction(key: string): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const trimmed = String(key ?? "").trim();
  if (trimmed.length > 512) return { error: "That does not look like an Anthropic API key." };
  if (!trimmed) {
    if (getSettings(user.id)?.anthropic_key_enc) return { ok: true };
    return { error: "Anthropic API key is required." };
  }
  patchSettings(user.id, { anthropic_key_enc: encryptSecret(trimmed) });
  return { ok: true };
}

export async function saveDefaultFromAction(from: string): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const value = String(from ?? "").trim();
  if (value.length > 320) return { error: "Default From is too long." };
  patchSettings(user.id, { default_from: value || null });
  return { ok: true };
}

export async function saveSmtpAction(input: {
  host: string;
  port: string | number;
  user: string;
  pass: string;
  from_domain?: string;
}): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };

  const host = String(input.host ?? "").trim();
  const port = Number(input.port || 465);
  const smtpUser = String(input.user ?? "").trim();
  const pass = String(input.pass ?? "");
  const fromDomain = String(input.from_domain ?? "").trim().toLowerCase() || null;

  if (!host || !smtpUser) return { error: "SMTP host and username are required." };
  if (host.length > 253 || smtpUser.length > 320 || pass.length > 1024 || (fromDomain?.length ?? 0) > 253) {
    return { error: "SMTP settings are too long." };
  }
  if (!ALLOWED_SMTP_PORTS.has(port)) return { error: `SMTP port must be ${ALLOWED_SMTP_PORTS_TEXT}.` };

  const limited = smtpSaveRateLimit(user.id, await currentClientIp());
  if (!limited.ok) return { error: `Too many SMTP changes. Try again in ${Math.ceil(limited.retryAfterSec / 60)} min.` };

  try {
    await assertSafeSmtpHost(host, port);
  } catch (e) {
    return { error: publicSmtpError(e) };
  }

  const current = getSettings(user.id);
  const source = resolveSmtpPasswordSource(current, { host, port, user: smtpUser, pass });
  if ("error" in source) return { error: source.error };
  const passEnc = "typed" in source ? encryptSecret(source.typed) : source.savedEnc;

  patchSettings(user.id, {
    smtp_host: host,
    smtp_port: port,
    smtp_user: smtpUser,
    smtp_pass_enc: passEnc,
    smtp_from_domain: fromDomain,
  });
  return { ok: true };
}

export async function testSmtpAction(input: {
  host: string;
  port: string | number;
  user: string;
  pass: string;
}): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };

  const host = String(input.host ?? "").trim();
  const port = Number(input.port || 465);
  const smtpUser = String(input.user ?? "").trim();
  if (!host || !smtpUser) return { error: "SMTP host and username are required." };
  if (host.length > 253 || smtpUser.length > 320 || String(input.pass ?? "").length > 1024) {
    return { error: "SMTP settings are too long." };
  }
  if (!ALLOWED_SMTP_PORTS.has(port)) return { error: `SMTP port must be ${ALLOWED_SMTP_PORTS_TEXT}.` };

  const current = getSettings(user.id);
  const source = resolveSmtpPasswordSource(current, { host, port, user: smtpUser, pass: String(input.pass ?? "") });
  if ("error" in source) return { error: source.error };
  const pass = "typed" in source ? source.typed : decryptSecret(source.savedEnc) ?? "";
  if (!pass) return { error: "SMTP password is required." };

  const limited = smtpTestRateLimit(user.id, await currentClientIp());
  if (!limited.ok) {
    return { error: `Too many SMTP tests. Try again in ${Math.ceil(limited.retryAfterSec / 60)} min.` };
  }

  try {
    await assertSafeSmtpHost(host, port);
    await testSmtpAuth({ host, port, user: smtpUser, pass });
    return { ok: true };
  } catch (e) {
    return { error: publicSmtpError(e) };
  }
}

export async function changePasswordAction(input: {
  current: string;
  next: string;
}): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const result = await changeUserPassword(user.id, String(input.current ?? ""), String(input.next ?? ""));
  if ("error" in result) return result;
  // Every session (including stolen ones) was revoked; keep this browser signed in.
  await setSessionCookieForUser(user.id);
  return { ok: true };
}

export async function listUserMailboxes(): Promise<MailboxRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  return listMailboxes(user.id);
}

/** Domains mailboxes can be created on (MACROMAIL_MAILBOX_DOMAINS). */
export async function listMailboxDomains(): Promise<string[]> {
  return mailboxDomains();
}

export async function createMailboxAction(input: {
  address: string;
  displayName?: string;
}): Promise<{ ok: true; address: string; note: string } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const result = await createMailbox(user.id, input.address, input.displayName ?? null);
  if (result.error) return { error: result.error };
  return { ok: true, address: result.mailbox?.address ?? input.address, note: result.note ?? INBOUND_NOTE };
}

export async function listMailboxMessagesAction(
  address: string,
): Promise<{ messages: MailboxMessageRow[]; note: string } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const result = await listMailboxMessages(user.id, address, { limit: 100 });
  if (result.error) return { error: result.error };
  return { messages: result.messages ?? [], note: result.note ?? INBOUND_NOTE };
}

export async function markMailboxReadAction(
  address: string,
  ids: string[],
): Promise<{ ok: true } | { error: string }> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };
  const result = await markMailboxMessagesRead(user.id, address, ids);
  if (result.error) return { error: result.error };
  return { ok: true };
}

export type SendEmailResult =
  | { error: string }
  | {
      ok: true;
      id: string;
      status: string;
      simulated: boolean;
      internal_deliveries: number;
      provider: string;
    };

function splitRecipients(raw: string): string[] {
  return String(raw ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Validate dashboard input with the same schema and caps as REST and MCP. */
function validateDashboardSend(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  internalOnly?: boolean;
}): { error: string } | { payload: ReturnType<typeof normalizeSend> } {
  const from = String(input.from ?? "").trim();
  const to = splitRecipients(input.to);
  const subject = String(input.subject ?? "").trim();
  const text = String(input.text ?? "");
  if (!from || !to.length || !subject || !text.trim()) {
    return { error: "From, to, subject, and body are required." };
  }
  const parsed = sendSchema.safeParse({ from, to, subject, text, internal_only: input.internalOnly === true });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid email." };
  return { payload: normalizeSend(parsed.data) };
}

export async function sendEmailAction(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  internalOnly?: boolean;
}): Promise<SendEmailResult> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };

  const checked = validateDashboardSend(input);
  if ("error" in checked) return checked;

  const result = await sendAndLog({
    ...checked.payload,
    userId: user.id,
    source: "dashboard",
  });
  if (result.status === "failed") {
    return { error: honestSendError(result.error) };
  }
  return {
    ok: true,
    id: result.id,
    status: result.status,
    simulated: result.simulated,
    internal_deliveries: result.internal_deliveries,
    provider: result.provider,
  };
}

function honestSendError(raw: string | null | undefined): string {
  return raw?.trim() || "Failed to send email.";
}

export async function sendInternalAction(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<SendEmailResult> {
  const originError = await requireMutationOrigin();
  if (originError) return { error: originError };
  const user = await getCurrentUser();
  if (!user) return { error: "You're not signed in." };

  const checked = validateDashboardSend({ ...input, internalOnly: true });
  if ("error" in checked) return checked;
  const { payload } = checked;

  const owned = await listMailboxes(user.id);
  const ownedSet = new Set(owned.map((b) => b.address));
  const fromAddr = parseAddress(payload.from).email;
  if (!ownedSet.has(fromAddr)) {
    return { error: "Send from one of your MacroMail mailboxes." };
  }
  for (const dest of payload.to) {
    const addr = parseAddress(dest).email;
    const box = findDeliverableMailbox(addr);
    if (!box) {
      return {
        error: `${addr || dest} is not a MacroMail mailbox. Create it first, or use Send for outbound SMTP.`,
      };
    }
  }

  const result = await sendAndLog({
    ...payload,
    userId: user.id,
    source: "dashboard",
  });
  if (result.status === "failed") {
    return { error: honestSendError(result.error) };
  }
  return {
    ok: true,
    id: result.id,
    status: result.status,
    simulated: result.simulated,
    internal_deliveries: result.internal_deliveries,
    provider: result.provider,
  };
}
