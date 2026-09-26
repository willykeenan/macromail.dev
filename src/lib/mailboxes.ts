/**
 * Hosted mailboxes — MacroMail-native receiving addresses.
 *
 * A mailbox is an address MacroMail itself answers for. Mailboxes can only be
 * created on domains the server operator owns (MACROMAIL_MAILBOX_DOMAINS), so
 * no account can claim an address on someone else's domain and intercept mail
 * meant for the internet. Mail sent through MacroMail to an address on one of
 * those domains is delivered internally; every other recipient goes out
 * through the sender's SMTP. Internet inbound (public MX) is not available.
 */

import {
  countMailboxMessagesForBox,
  countMailboxesForUser,
  findMailboxByAddress as dbFindMailboxByAddress,
  insertMailbox,
  insertMailboxMessage,
  listMailboxMessagesForBox,
  listMailboxesForUser,
  markMailboxMessagesReadForBox,
  trimMailboxMessages,
} from "@/lib/db";
import { mailboxAddress } from "@/lib/email/address";
import { id } from "@/lib/ids";
import {
  MAX_ADDRESS_LENGTH,
  MAX_DISPLAY_NAME,
  MAX_MAILBOXES_PER_USER,
  MAX_MESSAGES_PER_MAILBOX,
} from "@/lib/limits";
import type { MailboxRow, MailboxMessageRow } from "@/lib/types/db";

export const INBOUND_NOTE =
  "Internet inbound is not available. Mailboxes only receive mail sent through MacroMail to another MacroMail mailbox.";

/**
 * Domains this server answers for. Set MACROMAIL_MAILBOX_DOMAINS to a
 * comma-separated list of domains you control. The default, example.com, is
 * reserved by IANA and can never receive real internet mail, so internal
 * delivery on it cannot capture anyone's outbound mail.
 */
export const DEFAULT_MAILBOX_DOMAINS = ["example.com"];

export function mailboxDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.MACROMAIL_MAILBOX_DOMAINS?.trim();
  if (!raw) return [...DEFAULT_MAILBOX_DOMAINS];
  const list = raw
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, ""))
    .filter((d) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(d));
  return list.length ? [...new Set(list)] : [...DEFAULT_MAILBOX_DOMAINS];
}

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1).toLowerCase() : "";
}

/** True when the address is on a domain this server answers for. */
export function isMailboxDomainAddress(address: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const domain = domainOf(normalizeAddress(address));
  return Boolean(domain) && mailboxDomains(env).includes(domain);
}

export function normalizeAddress(address: string): string {
  return (address || "").trim().toLowerCase();
}

/** "Display Name <user@host>" → parts; bare addresses pass through. */
export function parseAddress(input: string): { email: string; name: string | null } {
  const m = /^(.*)<([^<>]+)>\s*$/.exec((input || "").trim());
  if (m) {
    return { email: normalizeAddress(m[2]!), name: m[1]!.trim().replace(/^"|"$/g, "") || null };
  }
  return { email: normalizeAddress(input), name: null };
}

export type MailboxErrorCode = "invalid_address" | "domain_not_allowed" | "address_taken" | "limit_reached";

export async function createMailbox(
  userId: string,
  address: string,
  displayName?: string | null,
): Promise<{
  mailbox?: MailboxRow;
  error?: string;
  code?: MailboxErrorCode;
  existing?: boolean;
  inbound?: "internal_only";
  note?: string;
}> {
  const raw = String(address ?? "");
  if (raw.length > MAX_ADDRESS_LENGTH) return { error: "Invalid mailbox address.", code: "invalid_address" };
  let addr: string;
  try {
    // Bare address only: no display name, one @, valid local part and domain.
    if (/[<>]/.test(raw)) throw new Error("display name");
    addr = mailboxAddress(raw.trim()).toLowerCase();
  } catch {
    return { error: "Invalid mailbox address.", code: "invalid_address" };
  }

  const domains = mailboxDomains();
  if (!domains.includes(domainOf(addr))) {
    return {
      error: `Mailboxes can only be created on this server's domain${domains.length === 1 ? "" : "s"}: ${domains.join(", ")}.`,
      code: "domain_not_allowed",
    };
  }

  const name = displayName?.trim() || null;
  // Printable ASCII without <, >, " or \ so the name always forms a valid From header.
  if (name && (name.length > MAX_DISPLAY_NAME || !/^[\x20-\x7e]+$/.test(name) || /[<>"\\]/.test(name))) {
    return {
      error: `Display name must be at most ${MAX_DISPLAY_NAME} plain ASCII characters, without < > " or \\.`,
      code: "invalid_address",
    };
  }

  const taken = dbFindMailboxByAddress(addr);
  if (taken) {
    if (taken.user_id === userId) {
      return { mailbox: taken, existing: true, inbound: "internal_only", note: INBOUND_NOTE };
    }
    return { error: "Address is already claimed by another account.", code: "address_taken" };
  }

  if (countMailboxesForUser(userId) >= MAX_MAILBOXES_PER_USER) {
    return { error: `An account can have at most ${MAX_MAILBOXES_PER_USER} mailboxes.`, code: "limit_reached" };
  }

  const row: MailboxRow = {
    id: id("mbx"),
    user_id: userId,
    address: addr,
    display_name: name,
    created_at: new Date().toISOString(),
  };
  try {
    insertMailbox(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/unique/i.test(msg)) return { error: "Address is already claimed by another account.", code: "address_taken" };
    return { error: "Could not create mailbox.", code: "invalid_address" };
  }
  return { mailbox: row, inbound: "internal_only", note: INBOUND_NOTE };
}

export async function listMailboxes(userId: string): Promise<MailboxRow[]> {
  return listMailboxesForUser(userId);
}

export async function findMailboxByAddress(address: string): Promise<MailboxRow | null> {
  return dbFindMailboxByAddress(normalizeAddress(address));
}

/** A registered mailbox on a currently allowed domain, or null. */
export function findDeliverableMailbox(address: string): MailboxRow | null {
  const addr = normalizeAddress(address);
  if (!isMailboxDomainAddress(addr)) return null;
  return dbFindMailboxByAddress(addr);
}

/**
 * Internal delivery: land one copy of an email in each registered mailbox
 * among its recipients. Only addresses on this server's mailbox domains are
 * considered. Every copy lists the To and Cc recipients only — Bcc
 * recipients get their own copy but are never shown to anyone.
 *
 * Callers (sendAndLog) must already have checked that the sender owns the
 * From mailbox and that any outbound leg succeeded.
 */
export async function deliverToMailboxes(params: {
  emailId: string;
  from: string;
  to: string[];
  cc?: string[] | null;
  bcc?: string[] | null;
  subject: string;
  text?: string | null;
  html?: string | null;
}): Promise<{ delivered: number; deliveredTo: string[]; undeliverable: string[] }> {
  const from = parseAddress(params.from);
  const visible = [...params.to, ...(params.cc ?? [])].map((r) => parseAddress(r).email).filter(Boolean);
  const seen = new Set<string>();
  const deliveredTo: string[] = [];
  const undeliverable: string[] = [];
  for (const raw of [...params.to, ...(params.cc ?? []), ...(params.bcc ?? [])]) {
    const addr = parseAddress(raw).email;
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    if (!isMailboxDomainAddress(addr)) continue;
    const mailbox = dbFindMailboxByAddress(addr);
    if (!mailbox) {
      undeliverable.push(addr);
      continue;
    }
    const row: MailboxMessageRow = {
      id: id("mbm"),
      mailbox_id: mailbox.id,
      user_id: mailbox.user_id,
      email_id: params.emailId,
      from_addr: from.email,
      from_name: from.name,
      to_addrs: [...new Set(visible)],
      subject: params.subject || "",
      text: params.text ?? null,
      html: params.html ?? null,
      read: false,
      created_at: new Date().toISOString(),
    };
    try {
      insertMailboxMessage(row);
      if (countMailboxMessagesForBox(mailbox.id) > MAX_MESSAGES_PER_MAILBOX) {
        trimMailboxMessages(mailbox.id, MAX_MESSAGES_PER_MAILBOX);
      }
      deliveredTo.push(addr);
    } catch (e) {
      console.error("mailbox delivery failed:", e instanceof Error ? e.message : e);
      undeliverable.push(addr);
    }
  }
  return { delivered: deliveredTo.length, deliveredTo, undeliverable };
}

export async function listMailboxMessages(
  userId: string,
  address: string,
  opts?: { since?: string; unreadOnly?: boolean; limit?: number },
): Promise<{ messages?: MailboxMessageRow[]; error?: string; inbound?: "internal_only"; note?: string }> {
  const mailbox = dbFindMailboxByAddress(normalizeAddress(address));
  if (!mailbox || mailbox.user_id !== userId) {
    return { error: "Mailbox not found." };
  }
  const messages = listMailboxMessagesForBox(mailbox.id, opts);
  return { messages, inbound: "internal_only", note: INBOUND_NOTE };
}

export async function markMailboxMessagesRead(
  userId: string,
  address: string,
  ids: string[],
): Promise<{ updated?: number; error?: string }> {
  const mailbox = dbFindMailboxByAddress(normalizeAddress(address));
  if (!mailbox || mailbox.user_id !== userId) {
    return { error: "Mailbox not found." };
  }
  if (!ids.length) return { updated: 0 };
  const updated = markMailboxMessagesReadForBox(mailbox.id, ids);
  return { updated };
}
