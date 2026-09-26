import { NextResponse } from "next/server";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { sendSchema, normalizeSend } from "@/lib/email/schema";
import { sendAndLog, sendErrorStatus } from "@/lib/email/send";
import { listEmailsForUser } from "@/lib/db";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

/** POST /v1/emails — send a single email. */
export async function POST(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const read = await readJsonBody(req);
  if (!read.ok) {
    return NextResponse.json(
      {
        error: {
          code: read.status === 413 ? "payload_too_large" : "validation_error",
          message: read.message,
          fix: "Provide from, to, subject, and html or text.",
        },
      },
      { status: read.status === 413 ? 413 : 422 },
    );
  }

  const parsed = sendSchema.safeParse(read.value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: first?.message ?? "Invalid request.",
          fix: "Provide from, to, subject, and html or text.",
        },
      },
      { status: 422 },
    );
  }

  const result = await sendAndLog({
    ...normalizeSend(parsed.data),
    userId: authed.userId,
    apiKeyId: authed.keyId,
    apiKeyEnv: authed.env,
    source: "api",
  });

  if (result.status === "failed") {
    return NextResponse.json(
      { error: { code: result.error_code ?? "send_failed", message: result.error ?? "Failed to send email." } },
      { status: sendErrorStatus(result.error_code) },
    );
  }

  return NextResponse.json(
    {
      id: result.id,
      status: result.status,
      created_at: result.created_at,
      simulated: result.simulated,
      internal_deliveries: result.internal_deliveries,
      internal_undeliverable: result.internal_undeliverable,
    },
    { status: 200 },
  );
}

/** GET /v1/emails — list recent emails for the authenticated account. */
export async function GET(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const url = new URL(req.url);
  const limit = Math.max(1, Math.min(Math.floor(Number(url.searchParams.get("limit"))) || 50, 100));

  const data = listEmailsForUser(authed.userId, limit);

  return NextResponse.json({
    object: "list",
    data: data.map((e) => ({
      id: e.id,
      from: e.from_addr,
      to: e.to_addrs,
      subject: e.subject,
      status: e.status,
      simulated: e.simulated,
      provider: e.provider,
      created_at: e.created_at,
    })),
    has_more: data.length === limit,
  });
}
