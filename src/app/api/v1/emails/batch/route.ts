import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { sendSchema, normalizeSend } from "@/lib/email/schema";
import { sendAndLog } from "@/lib/email/send";
import { readJsonBody } from "@/lib/http/body";
import { MAX_BATCH_BODY_BYTES } from "@/lib/limits";

export const runtime = "nodejs";

const batchSchema = z.array(sendSchema).min(1).max(100);

/** POST /v1/emails/batch — send up to 100 emails in one call. */
export async function POST(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const read = await readJsonBody(req, MAX_BATCH_BODY_BYTES);
  if (!read.ok) {
    return NextResponse.json(
      {
        error: {
          code: read.status === 413 ? "payload_too_large" : "validation_error",
          message: read.status === 413 ? read.message : "Request body must be a JSON array.",
        },
      },
      { status: read.status === 413 ? 413 : 422 },
    );
  }

  const parsed = batchSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Send an array of 1–100 emails.",
        },
      },
      { status: 422 },
    );
  }

  const results = [];
  for (const item of parsed.data) {
    results.push(
      await sendAndLog({
        ...normalizeSend(item),
        userId: authed.userId,
        apiKeyId: authed.keyId,
        apiKeyEnv: authed.env,
        source: "api",
      }),
    );
  }

  return NextResponse.json({
    object: "list",
    data: results.map((r) => ({
      id: r.id,
      status: r.status,
      simulated: r.simulated,
      internal_deliveries: r.internal_deliveries,
      ...(r.status === "failed" ? { error: { code: r.error_code ?? "send_failed", message: r.error } } : {}),
    })),
  });
}
