const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const DOT_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const SIMPLE_DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._'-]*$/;

export interface ParsedMailbox {
  address: string;
  name: string | null;
  formatted: string;
}

export interface SendHeaderInput {
  from: string;
  to: string[];
  subject: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
}

export function isValidDomain(input: string): boolean {
  const domain = input.trim().toLowerCase();
  if (domain.length === 0 || domain.length > 253 || !domain.includes(".")) return false;

  return domain.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}

function parseAddress(address: string): string {
  if (address.length > 254 || !/^[\x21-\x7e]+$/.test(address)) {
    throw new Error("Email address must be a valid ASCII mailbox.");
  }

  const at = address.lastIndexOf("@");
  if (at <= 0 || at !== address.indexOf("@")) {
    throw new Error("Email address must contain exactly one @.");
  }

  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase();
  if (local.length > 64 || !DOT_ATOM.test(local)) {
    throw new Error("Email address has an invalid local part.");
  }
  if (!isValidDomain(domain)) {
    throw new Error("Email address has an invalid domain.");
  }
  return `${local}@${domain}`;
}

function parseDisplayName(input: string): string {
  let name = input.trim();
  if (!name) throw new Error("Display name cannot be empty.");
  if (name.length > 200 || CONTROL_CHARACTER.test(name) || !/^[\x20-\x7e]+$/.test(name)) {
    throw new Error("Display name contains invalid characters.");
  }

  const startsQuoted = name.startsWith('"');
  const endsQuoted = name.endsWith('"');
  if (startsQuoted || endsQuoted) {
    if (!startsQuoted || !endsQuoted || name.length < 2) {
      throw new Error("Display name has unmatched quotes.");
    }
    name = name.slice(1, -1);
    let decoded = "";
    for (let i = 0; i < name.length; i += 1) {
      const char = name[i];
      if (char === "\\") {
        const next = name[i + 1];
        if (next !== "\\" && next !== '"') {
          throw new Error("Display name has an invalid escape sequence.");
        }
        decoded += next;
        i += 1;
      } else if (char === '"') {
        throw new Error("Display name has an unescaped quote.");
      } else {
        decoded += char;
      }
    }
    name = decoded;
  } else if (name.includes('"') || name.includes("\\")) {
    throw new Error("Display name quotes and escapes must be paired.");
  }

  if (!name) throw new Error("Display name cannot be empty.");
  return name;
}

function formatDisplayName(name: string): string {
  if (SIMPLE_DISPLAY_NAME.test(name)) return name;
  return `"${name.replace(/(["\\])/g, "\\$1")}"`;
}

/** Parse exactly one mailbox, optionally with an RFC-style display name. */
export function parseMailbox(input: string): ParsedMailbox {
  if (typeof input !== "string") throw new Error("Mailbox must be a string.");
  if (input.length > 512 || CONTROL_CHARACTER.test(input)) {
    throw new Error("Mailbox contains invalid header characters.");
  }

  const value = input.trim();
  if (!value) throw new Error("Mailbox cannot be empty.");

  const hasAngle = value.includes("<") || value.includes(">");
  if (!hasAngle) {
    const address = parseAddress(value);
    return { address, name: null, formatted: address };
  }

  const match = /^(.+?)\s*<([^<>]+)>$/.exec(value);
  if (!match) throw new Error("Mailbox display-name syntax is malformed.");

  const name = parseDisplayName(match[1]);
  const address = parseAddress(match[2].trim());
  return {
    address,
    name,
    formatted: `${formatDisplayName(name)} <${address}>`,
  };
}

export function canonicalMailbox(input: string): string {
  return parseMailbox(input).formatted;
}

export function mailboxAddress(input: string): string {
  return parseMailbox(input).address;
}

export function assertHeaderValue(input: string, label: string): void {
  if (typeof input !== "string" || !input || input.length > 998 || CONTROL_CHARACTER.test(input)) {
    throw new Error(`${label} contains invalid header characters.`);
  }
}

/** Defense-in-depth validation for provider callers that bypass the API schema. */
export function assertSendHeaders(input: SendHeaderInput): void {
  parseMailbox(input.from);
  if (!Array.isArray(input.to) || input.to.length === 0) {
    throw new Error("At least one To recipient is required.");
  }
  for (const mailbox of input.to) parseMailbox(mailbox);
  for (const mailbox of input.cc ?? []) parseMailbox(mailbox);
  for (const mailbox of input.bcc ?? []) parseMailbox(mailbox);
  if (input.reply_to !== undefined) parseMailbox(input.reply_to);
  assertHeaderValue(input.subject, "Subject");
}

/** Message-IDs use the configured sender domain, then the validated From domain. */
export function resolveMessageIdDomain(from: string, configuredFromDomain?: string): string {
  const configured = configuredFromDomain?.trim().toLowerCase();
  if (configured) {
    if (!isValidDomain(configured)) throw new Error("SMTP from-domain setting is not a valid domain.");
    return configured;
  }

  try {
    const domain = mailboxAddress(from).split("@")[1];
    if (domain && isValidDomain(domain)) return domain;
  } catch {
    // Provider validation will report the malformed From value separately.
  }
  return "macromail.dev";
}
