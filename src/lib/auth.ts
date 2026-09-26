import { cookies, headers } from "next/headers";
import { id } from "@/lib/ids";
import { sha256 } from "@/lib/crypto";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { deleteSession, findSessionById, findUserById, insertSession } from "@/lib/db";
import { checkMutationOrigin, mutationOriginError } from "@/lib/origin";
import {
  mintSessionCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionCookieOptions,
  verifySessionCookie,
} from "@/lib/session-cookie";
import {
  authenticateUser,
  changeUserPassword,
  hashPassword,
  registerUser,
  toAuthUser,
  verifyPassword,
  type AuthUser,
} from "@/lib/auth-core";

export type { AuthUser };
export { authenticateUser, changeUserPassword, clientIpFromHeaders, hashPassword, registerUser, verifyPassword };

/** Client IP of the current request, for rate limits. */
export async function currentClientIp(): Promise<string> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    return "unknown";
  }
}

export async function requireMutationOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    if (!checkMutationOrigin(h)) return mutationOriginError();
    return null;
  } catch {
    return mutationOriginError();
  }
}

async function issueSession(userId: string): Promise<{ cookie: string; expiresAtMs: number; sessionId: string }> {
  const sessionId = id("ses");
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  insertSession({
    id: sessionId,
    user_id: userId,
    token_hash: sha256(sessionId),
    expires_at: new Date(expiresAtMs).toISOString(),
    created_at: new Date().toISOString(),
  });
  const cookie = await mintSessionCookie(sessionId, expiresAtMs);
  return { cookie, expiresAtMs, sessionId };
}

export async function setSessionCookieForUser(userId: string): Promise<void> {
  const { cookie, expiresAtMs } = await issueSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, cookie, sessionCookieOptions(expiresAtMs));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (raw) {
    const parsed = await verifySessionCookie(raw);
    if (parsed) deleteSession(parsed.sessionId);
  }
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(0), expires: new Date(0), maxAge: 0 });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const store = await cookies();
    const raw = store.get(SESSION_COOKIE)?.value;
    const parsed = await verifySessionCookie(raw);
    if (!parsed) return null;
    const session = findSessionById(parsed.sessionId);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() < Date.now()) {
      deleteSession(session.id);
      return null;
    }
    const user = findUserById(session.user_id);
    if (!user) return null;
    return toAuthUser(user);
  } catch {
    return null;
  }
}
