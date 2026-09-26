import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/crypto";
import { googleAuthUrl, googleConfigured } from "@/lib/inbox/google";
import { microsoftAuthUrl, microsoftConfigured } from "@/lib/inbox/microsoft";

export const runtime = "nodejs";

type UiProvider = "google" | "outlook";
const OAUTH_NONCE_COOKIE = "mm_inbox_oauth_nonce";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

/**
 * GET /api/inbox/connect/:provider — kick off OAuth.
 * State = encrypted {userId, provider, nonce, ts} so the callback can verify the
 * same signed-in user without a server-side store.
 */
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const { provider } = await params;
  if (provider !== "google" && provider !== "outlook") {
    return NextResponse.json({ error: { code: "bad_provider", message: "Unknown provider." } }, { status: 400 });
  }
  const p = provider as UiProvider;

  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/inbox/callback/${p}`;
  const nonce = randomBytes(18).toString("base64url");
  const state = encryptSecret(
    JSON.stringify({ userId: user.id, provider: p, nonce, ts: Date.now() }),
  );

  let providerUrl: string;
  if (p === "google") {
    if (!googleConfigured()) {
      return NextResponse.redirect(`${origin}/app/accounts?error=google_not_configured`);
    }
    providerUrl = googleAuthUrl(state, redirectUri);
  } else {
    if (!microsoftConfigured()) {
      return NextResponse.redirect(`${origin}/app/accounts?error=microsoft_not_configured`);
    }
    providerUrl = microsoftAuthUrl(state, redirectUri);
  }

  const response = NextResponse.redirect(providerUrl);
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    maxAge: OAUTH_STATE_TTL_SECONDS,
    path: "/api/inbox/callback",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
