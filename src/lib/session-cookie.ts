/**
 * HMAC-signed session cookie. Uses Web Crypto so Edge middleware can verify
 * the cookie without node:sqlite or node:crypto.
 */

const encoder = new TextEncoder();

export const SESSION_COOKIE = "mm_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function sessionSecret(
  environment: { SESSION_SECRET?: string; TOKEN_ENC_KEY?: string; NODE_ENV?: string } = process.env,
): string {
  const dedicated = environment.SESSION_SECRET?.trim();
  if (dedicated) return dedicated;
  const enc = environment.TOKEN_ENC_KEY?.trim();
  if (enc) return enc;
  if (environment.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET (or TOKEN_ENC_KEY) is required outside local development");
  }
  return "macromail-local-dev-session-secret";
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return b64url(sig);
}

function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintSessionCookie(
  sessionId: string,
  expiresAtMs: number,
  environment?: Parameters<typeof sessionSecret>[0],
): Promise<string> {
  const payload = `${sessionId}.${expiresAtMs}`;
  const sig = await hmacHex(sessionSecret(environment), payload);
  return `${payload}.${sig}`;
}

export async function verifySessionCookie(
  raw: string | undefined | null,
  environment?: Parameters<typeof sessionSecret>[0],
): Promise<{ sessionId: string; expiresAtMs: number } | null> {
  if (!raw) return null;
  const lastDot = raw.lastIndexOf(".");
  if (lastDot <= 0) return null;
  const payload = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  let expected: string;
  try {
    expected = await hmacHex(sessionSecret(environment), payload);
  } catch {
    return null;
  }
  if (!timingEqual(expected, sig)) return null;
  const sep = payload.lastIndexOf(".");
  if (sep <= 0) return null;
  const sessionId = payload.slice(0, sep);
  const expiresAtMs = Number(payload.slice(sep + 1));
  if (!sessionId || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;
  return { sessionId, expiresAtMs };
}

export function sessionCookieOptions(expiresAtMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAtMs),
  };
}
