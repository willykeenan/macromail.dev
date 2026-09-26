import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { keyFromRequest, aiEnabled, aiDisabledResponse, AiDisabledError } from "@/lib/ai";
import { draftReply, resolveUserAnthropicKey } from "@/lib/inbox/service";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({
  threadId: z.string().min(1),
  instructions: z.string().optional(),
});

/** POST /api/inbox/draft — draft a reply to a thread using its context. */
export async function POST(req: Request) {
  if (!requestOriginOk(req)) {
    return NextResponse.json({ error: { code: "forbidden_origin", message: mutationOriginError() } }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const read = await readJsonBody(req);
  if (!read.ok && read.status === 413) {
    return NextResponse.json({ error: { code: "payload_too_large", message: read.message } }, { status: 413 });
  }
  const parsed = schema.safeParse(read.ok ? read.value : null);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request." } },
      { status: 422 },
    );
  }

  const key = await resolveUserAnthropicKey(user.id, keyFromRequest(req));
  if (!aiEnabled(key)) return NextResponse.json(aiDisabledResponse(), { status: 503 });

  try {
    const draft = await draftReply(user.id, parsed.data.threadId, parsed.data.instructions, key);
    return NextResponse.json({ ok: true, draft });
  } catch (e) {
    if (e instanceof AiDisabledError) return NextResponse.json(aiDisabledResponse(), { status: 503 });
    return NextResponse.json({ ok: false, error: { code: "ai_error", message: (e as Error).message } }, { status: 500 });
  }
}
