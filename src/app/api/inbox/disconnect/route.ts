import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { disconnectAccount } from "@/lib/inbox/service";
import { requestOriginOk, mutationOriginError } from "@/lib/origin";
import { readJsonBody } from "@/lib/http/body";

export const runtime = "nodejs";

const schema = z.object({ accountId: z.string().min(1) });

/** POST /api/inbox/disconnect — remove a connected account + its AI labels. */
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

  try {
    await disconnectAccount(user.id, parsed.data.accountId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: { code: "server_error", message: (e as Error).message } }, { status: 500 });
  }
}
