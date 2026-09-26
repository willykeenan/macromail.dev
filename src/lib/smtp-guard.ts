/**
 * SSRF guard for user-supplied SMTP hosts. Blocks loopback, RFC1918, link-local,
 * metadata, and unique-local addresses after DNS resolution.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_NAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata",
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split(".").map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const n = ip.toLowerCase();
    if (n === "::" || n === "::1" || n === "0:0:0:0:0:0:0:0" || n === "0:0:0:0:0:0:0:1") return true;
    if (n.startsWith("fe80:") || n.startsWith("fe8") || n.startsWith("fe9") || n.startsWith("fea") || n.startsWith("feb")) {
      return true;
    }
    if (n.startsWith("fc") || n.startsWith("fd")) return true;
    if (n.startsWith("ff")) return true;
    if (n.startsWith("::ffff:")) return isPrivateOrReservedIp(n.slice("::ffff:".length));
    return false;
  }
  return true;
}

export function isBlockedSmtpHostname(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h.includes("/") || h.includes("\\") || h.includes(" ") || h.includes("@")) return true;
  if (BLOCKED_NAMES.has(h)) return true;
  if (h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan")) return true;
  if (isIP(h) && isPrivateOrReservedIp(h)) return true;
  return false;
}

/**
 * Submission ports only. Port 25 is server-to-server relay; allowing it would
 * let accounts probe arbitrary mail exchangers from this server's IP.
 */
export const ALLOWED_SMTP_PORTS = new Set([465, 587, 2525]);
export const ALLOWED_SMTP_PORTS_TEXT = "465, 587, or 2525";

/** Port 465 is implicit TLS. 587 / 2525 speak plaintext then STARTTLS. */
export function smtpUsesStartTls(port: number): boolean {
  return port !== 465;
}

export interface SmtpConnectTarget {
  address: string;
  family: number;
  servername: string;
}

/**
 * Resolve the SMTP host, reject private/reserved answers, and return the
 * address to connect to so the later socket cannot be rebound to a private IP.
 */
export async function resolveSafeSmtpTarget(host: string, port?: number): Promise<SmtpConnectTarget> {
  const h = (host || "").trim();
  if (!h) throw new Error("SMTP host is required.");
  if (isBlockedSmtpHostname(h)) throw new Error("SMTP host is not allowed.");
  if (port != null && !ALLOWED_SMTP_PORTS.has(port)) {
    throw new Error(`SMTP port is not allowed. Use ${ALLOWED_SMTP_PORTS_TEXT}.`);
  }
  if (isIP(h)) {
    if (isPrivateOrReservedIp(h)) throw new Error("SMTP host is not allowed.");
    return { address: h, family: isIP(h), servername: h };
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(h, { all: true });
  } catch {
    throw new Error("SMTP host could not be resolved.");
  }
  if (!addresses.length) throw new Error("SMTP host could not be resolved.");
  for (const a of addresses) {
    if (isPrivateOrReservedIp(a.address)) {
      throw new Error("SMTP host resolves to a private or reserved address.");
    }
  }
  const chosen = addresses[0]!;
  return { address: chosen.address, family: chosen.family, servername: h };
}

export async function assertSafeSmtpHost(host: string, port?: number): Promise<void> {
  await resolveSafeSmtpTarget(host, port);
}
