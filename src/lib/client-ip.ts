import { isIP } from "node:net";
import { isPrivateOrReservedIp } from "@/lib/smtp-guard";

/**
 * The client IP used for rate limits.
 *
 * X-Forwarded-For is a list the client can start. Proxies (Cloudflare,
 * Tailscale Funnel, Next itself) append the address they saw, so the
 * trustworthy entry is the last one added by a proxy — never the first.
 * Trailing private/loopback hops are local proxies (cloudflared, Docker) and
 * are skipped.
 *
 * MACROMAIL_TRUSTED_PROXY=cloudflare uses CF-Connecting-IP, which Cloudflare
 * always overwrites. Only set it when every request arrives through
 * Cloudflare; otherwise a client could send that header itself.
 */
export function clientIpFromHeaders(headersList: Headers, env: NodeJS.ProcessEnv = process.env): string {
  const mode = (env.MACROMAIL_TRUSTED_PROXY || "").trim().toLowerCase();
  if (mode === "cloudflare") {
    const cf = normalizeIp(headersList.get("cf-connecting-ip"));
    if (cf) return cf;
  }

  const hops = (headersList.get("x-forwarded-for") || "")
    .split(",")
    .map((h) => normalizeIp(h))
    .filter((h): h is string => Boolean(h));
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    if (!isPrivateOrReservedIp(hops[i]!)) return hops[i]!;
  }
  if (hops.length) return hops[hops.length - 1]!;

  return normalizeIp(headersList.get("x-real-ip")) || "unknown";
}

function normalizeIp(raw: string | null | undefined): string | null {
  let value = (raw || "").trim();
  if (!value) return null;
  // "[::1]:443" / "1.2.3.4:5678" forms from some proxies.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) value = bracketed[1]!;
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(":"));
  return isIP(value) ? value.toLowerCase() : null;
}
