import { addStoredBytes, getSettings, getStoredBytes, insertEmail } from "@/lib/db";
import { id } from "@/lib/ids";
import { decryptSecret } from "@/lib/crypto";
import { maxStoredBytesPerUser, storedMessageBytes } from "@/lib/limits";
import {
  deliverToMailboxes,
  findMailboxByAddress,
  isMailboxDomainAddress,
  parseAddress,
} from "@/lib/mailboxes";
import { internalSendRateLimit, sendRateLimit } from "@/lib/rate-limit";
import { assertSafeSmtpHost } from "@/lib/smtp-guard";
import { apiKeyForcesSimulation } from "./provider-policy";
import { MockProvider } from "./mock";
import { publicSmtpError, SmtpProvider, type SmtpEnvConfig } from "./smtp";
import type { EmailRow, KeyEnv } from "@/lib/types/db";
import type { SendEmailInput } from "./types";

export interface SendAndLogParams extends SendEmailInput {
  userId: string;
  apiKeyId?: string | null;
  apiKeyEnv?: KeyEnv;
  source: "api" | "mcp" | "dashboard";
}

/**
 * Why a send was refused. Pre-flight refusals (everything except no_smtp and
 * send_failed) happen before any delivery and are not written to the log.
 */
export type SendErrorCode =
  | "invalid_recipients"
  | "sender_not_owned"
  | "rate_limited"
  | "quota_exceeded"
  | "no_smtp"
  | "send_failed";

export interface SendAndLogResult {
  id: string;
  status: string;
  created_at: string;
  simulated: boolean;
  provider: string;
  provider_message_id: string | null;
  error: string | null;
  error_code: SendErrorCode | null;
  /** Copies landed in MacroMail-hosted mailboxes. */
  internal_deliveries: number;
  /** Addresses on this server's mailbox domains that have no mailbox. */
  internal_undeliverable: string[];
}

/** HTTP status for a failed send. */
export function sendErrorStatus(code: SendErrorCode | null): number {
  switch (code) {
    case "invalid_recipients":
      return 422;
    case "sender_not_owned":
      return 403;
    case "rate_limited":
      return 429;
    case "quota_exceeded":
      return 507;
    default:
      return 502;
  }
}

export const NO_SMTP_MESSAGE =
  "No SMTP account configured. Add your own SMTP credentials in Settings (/app/settings). MacroMail never sends from the server owner's mailbox.";

function loadUserSmtp(userId: string): SmtpEnvConfig | null {
  const settings = getSettings(userId);
  if (!settings?.smtp_host || !settings.smtp_user || !settings.smtp_pass_enc) return null;
  const pass = decryptSecret(settings.smtp_pass_enc);
  if (!pass) return null;
  return {
    host: settings.smtp_host.trim(),
    port: Number(settings.smtp_port || 465),
    user: settings.smtp_user.trim(),
    pass,
    fromDomain: settings.smtp_from_domain?.trim().toLowerCase() || undefined,
  };
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}

/**
 * Sends an email and records it in the `emails` table.
 *
 * - Recipients on this server's mailbox domains are delivered internally and
 *   never go out over SMTP. Everyone else goes out through the user's own SMTP
 *   account (never the server owner's mailbox).
 * - Internal delivery requires From to be one of the sender's own mailboxes,
 *   and runs only after the outbound leg (if any) succeeds.
 * - Test keys simulate everything, including internal delivery.
 */
export async function sendAndLog(p: SendAndLogParams): Promise<SendAndLogResult> {
  const createdAt = new Date().toISOString();
  const emailId = id("em");
  const to = p.to;
  const cc = p.cc ?? [];
  const bcc = p.bcc ?? [];
  const allRecipients = unique([...to, ...cc, ...bcc].map((r) => parseAddress(r).email));
  const internalRecipients = allRecipients.filter((r) => isMailboxDomainAddress(r));
  const externalRecipients = allRecipients.filter((r) => !isMailboxDomainAddress(r));
  const fromAddr = parseAddress(p.from).email;

  const refuse = (code: SendErrorCode, message: string): SendAndLogResult => ({
    id: emailId,
    status: "failed",
    created_at: createdAt,
    simulated: false,
    provider: "none",
    provider_message_id: null,
    error: message,
    error_code: code,
    internal_deliveries: 0,
    internal_undeliverable: [],
  });

  if (p.internal_only && externalRecipients.length) {
    return refuse(
      "invalid_recipients",
      `internal_only is set, but these recipients are not MacroMail mailbox addresses: ${externalRecipients.join(", ")}.`,
    );
  }

  // Anything touching this server's mailbox domains must come from a mailbox
  // the sender owns — no forged internal senders.
  if (internalRecipients.length || isMailboxDomainAddress(fromAddr)) {
    const owned = await findMailboxByAddress(fromAddr);
    if (!owned || owned.user_id !== p.userId || !isMailboxDomainAddress(fromAddr)) {
      return refuse(
        "sender_not_owned",
        "Mail to or from a MacroMail mailbox must be sent from one of your own mailboxes. Set From to a mailbox you created.",
      );
    }
  }

  const testKey = apiKeyForcesSimulation(p.apiKeyEnv);
  const copies = testKey ? 0 : internalRecipients.length;
  const logBytes = storedMessageBytes(p);
  const quota = maxStoredBytesPerUser();
  if (getStoredBytes(p.userId) + logBytes * (1 + copies) > quota) {
    return refuse(
      "quota_exceeded",
      `This account has reached its storage limit (${Math.round(quota / 1024 / 1024)} MB of stored mail).`,
    );
  }

  if (copies) {
    const limited = internalSendRateLimit(p.userId, copies);
    if (!limited.ok) {
      return refuse("rate_limited", `Internal delivery rate limit exceeded. Retry in ${limited.retryAfterSec}s.`);
    }
  }

  let status = externalRecipients.length ? "queued" : "internal";
  let providerName = "internal";
  let providerMessageId: string | null = null;
  let error: string | null = null;
  let errorCode: SendErrorCode | null = null;
  let simulated = false;
  let outboundOk = true;

  if (testKey) {
    const mock = new MockProvider("Simulated (test API key)");
    const res = await mock.send({ from: p.from, to, subject: p.subject, html: p.html, text: p.text, cc, bcc });
    providerMessageId = res.provider_message_id || null;
    status = "queued";
    simulated = true;
    providerName = mock.name;
  } else if (externalRecipients.length) {
    const smtp = loadUserSmtp(p.userId);
    if (!smtp) {
      status = "failed";
      error = NO_SMTP_MESSAGE;
      errorCode = "no_smtp";
      providerName = "none";
      outboundOk = false;
    } else {
      const limited = sendRateLimit(p.userId);
      if (!limited.ok) {
        return refuse("rate_limited", `Send rate limit exceeded. Retry in ${limited.retryAfterSec}s.`);
      }
      providerName = `SMTP (${smtp.host})`;
      try {
        await assertSafeSmtpHost(smtp.host, smtp.port);
        const provider = new SmtpProvider(smtp);
        const res = await provider.send({
          from: p.from,
          to,
          subject: p.subject,
          html: p.html,
          text: p.text,
          cc,
          bcc,
          reply_to: p.reply_to,
          tags: p.tags,
          // Mailbox-domain recipients are delivered here, not over SMTP.
          envelope_to: externalRecipients,
        });
        providerMessageId = res.provider_message_id || null;
        status = "sent";
        providerName = provider.name;
      } catch (e) {
        status = "failed";
        error = publicSmtpError(e);
        errorCode = "send_failed";
        outboundOk = false;
      }
    }
  }

  let internalDeliveries = 0;
  let undeliverable: string[] = [];
  if (!testKey && outboundOk && internalRecipients.length) {
    try {
      const delivered = await deliverToMailboxes({
        emailId,
        from: p.from,
        to,
        cc,
        bcc,
        subject: p.subject,
        text: p.text ?? null,
        html: p.html ?? null,
      });
      internalDeliveries = delivered.delivered;
      undeliverable = delivered.undeliverable;
    } catch (e) {
      console.error("mailbox delivery failed:", e instanceof Error ? e.message : String(e));
      undeliverable = internalRecipients;
    }
    if (!externalRecipients.length && internalDeliveries === 0) {
      status = "failed";
      errorCode = "invalid_recipients";
      error = `No MacroMail mailbox exists for: ${undeliverable.join(", ")}.`;
    }
  }

  const row: EmailRow = {
    id: emailId,
    user_id: p.userId,
    api_key_id: p.apiKeyId ?? null,
    from_addr: p.from,
    to_addrs: to,
    cc: cc.length ? cc : null,
    bcc: bcc.length ? bcc : null,
    reply_to: p.reply_to ?? null,
    subject: p.subject,
    html: p.html ?? null,
    text: p.text ?? null,
    tags: p.tags ?? null,
    status,
    provider: providerName,
    provider_message_id: providerMessageId,
    simulated: simulated || (externalRecipients.length > 0 && status !== "sent"),
    error,
    source: p.source,
    created_at: createdAt,
  };

  try {
    insertEmail(row);
    addStoredBytes(p.userId, logBytes * (1 + internalDeliveries));
  } catch (e) {
    console.error("emails insert failed:", e instanceof Error ? e.message : e);
  }

  return {
    id: emailId,
    status,
    created_at: createdAt,
    simulated: row.simulated,
    provider: providerName,
    provider_message_id: providerMessageId,
    error,
    error_code: errorCode,
    internal_deliveries: internalDeliveries,
    internal_undeliverable: undeliverable,
  };
}
