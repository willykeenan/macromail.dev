import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { id } from "@/lib/ids";
import { ACCOUNT_COLORS } from "@/lib/inbox/types";
import { exchangeGoogleCode, GOOGLE_SCOPES } from "@/lib/inbox/google";
import { exchangeMicrosoftCode, MICROSOFT_SCOPES } from "@/lib/inbox/microsoft";
import {
  countConnectedAccounts,
  findConnectedAccount,
  insertConnectedAccount,
  updateConnectedAccount,
} from "@/lib/db";
import type { InboxProvider } from "@/lib/types/db";

export const runtime = "nodejs";

const UI_TO_DB: Record<string, InboxProvider> = { google: "gmail", outlook: "outlook" };
const OAUTH_NONCE_COOKIE = "mm_inbox_oauth_nonce";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function oauthRedirect(target: string) {
  const response = NextResponse.redirect(target);
  response.cookies.set(OAUTH_NONCE_COOKIE, "", {
    expires: new Date(0),
    httpOnly: true,
    path: "/api/inbox/callback",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

/** GET /api/inbox/callback/:provider — OAuth redirect target. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const origin = new URL(req.url).origin;
  const accountsUrl = `${origin}/app/accounts`;

  if (provider !== "google" && provider !== "outlook") {
    return oauthRedirect(`${accountsUrl}?error=bad_provider`);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) return oauthRedirect(`${accountsUrl}?error=${encodeURIComponent(oauthError)}`);
  if (!code || !state) return oauthRedirect(`${accountsUrl}?error=missing_code`);

  // Verify state and that the signed-in user matches.
  let userId: string;
  try {
    const decoded = JSON.parse(decryptSecret(state) ?? "{}") as {
      userId?: string;
      provider?: string;
      nonce?: string;
      ts?: number;
    };
    const user = await getCurrentUser();
    const nonce = req.cookies.get(OAUTH_NONCE_COOKIE)?.value;
    const age = Date.now() - Number(decoded.ts);
    if (
      !user ||
      !decoded.userId ||
      decoded.userId !== user.id ||
      decoded.provider !== provider ||
      !nonce ||
      decoded.nonce !== nonce ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > OAUTH_STATE_TTL_MS
    ) {
      return oauthRedirect(`${accountsUrl}?error=state_mismatch`);
    }
    userId = user.id;
  } catch {
    return oauthRedirect(`${accountsUrl}?error=bad_state`);
  }

  const redirectUri = `${origin}/api/inbox/callback/${provider}`;

  try {
    const exchanged =
      provider === "google"
        ? await exchangeGoogleCode(code, redirectUri)
        : await exchangeMicrosoftCode(code, redirectUri);

    const dbProvider = UI_TO_DB[provider];
    const scopes = provider === "google" ? GOOGLE_SCOPES : MICROSOFT_SCOPES;
    const expiresAt = new Date(Date.now() + exchanged.expires_in * 1000).toISOString();

    const existing = findConnectedAccount(userId, dbProvider, exchanged.email);
    const refreshEnc = exchanged.refresh_token ? encryptSecret(exchanged.refresh_token) : undefined;

    if (existing?.id) {
      updateConnectedAccount(existing.id, {
        status: "connected",
        access_token_enc: encryptSecret(exchanged.access_token),
        token_expires_at: expiresAt,
        scopes,
        ...(refreshEnc ? { refresh_token_enc: refreshEnc } : {}),
      });
    } else {
      const count = countConnectedAccounts(userId);
      const color = ACCOUNT_COLORS[count % ACCOUNT_COLORS.length]!;
      insertConnectedAccount({
        id: id("acct"),
        user_id: userId,
        provider: dbProvider,
        email: exchanged.email,
        label: null,
        status: "connected",
        color,
        access_token_enc: encryptSecret(exchanged.access_token),
        refresh_token_enc: refreshEnc ?? null,
        token_expires_at: expiresAt,
        scopes,
        sync_cursor: null,
        last_sync_at: null,
        created_at: new Date().toISOString(),
      });
    }

    return oauthRedirect(`${accountsUrl}?connected=1`);
  } catch (e) {
    console.error("Mailbox OAuth callback failed", {
      provider,
      error: e instanceof Error ? e.name : "unknown",
    });
    return oauthRedirect(`${accountsUrl}?error=provider_callback_failed`);
  }
}
