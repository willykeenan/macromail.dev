import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { keyFromRequest, aiEnabled, aiDisabledResponse } from "@/lib/ai";
import { listThreads, getThread, triageThreads, resolveUserAnthropicKey } from "@/lib/inbox/service";
import type { MailThread } from "@/lib/inbox/types";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({
  threadIds: z.array(z.string()).max(50).optional(),
  accountId: z.string().optional(),
});

/** POST /api/inbox/triage — classify threads into AI labels + summaries. */
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
  const parsed = schema.safeParse(read.ok ? read.value : {});
  const body = parsed.success ? parsed.data : {};

  const key = await resolveUserAnthropicKey(user.id, keyFromRequest(req));
  if (!aiEnabled(key)) return NextResponse.json(aiDisabledResponse(), { status: 503 });

  try {
    let threads: MailThread[];
    if (body.threadIds && body.threadIds.length > 0) {
      const fetched = await Promise.all(body.threadIds.map((tid) => getThread(user.id, tid)));
      threads = fetched.filter((t): t is MailThread => Boolean(t));
    } else {
      threads = await listThreads(user.id, { accountId: body.accountId, limit: 25 });
    }
    const results = await triageThreads(user.id, threads, key);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: { code: "ai_error", message: (e as Error).message } }, { status: 500 });
  }
}
