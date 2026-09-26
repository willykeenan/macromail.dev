import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getThread } from "@/lib/inbox/service";

export const runtime = "nodejs";

/** GET /api/inbox/thread/:id — one full thread (id is the composite id). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const { id } = await params;
  try {
    const thread = await getThread(user.id, decodeURIComponent(id));
    if (!thread) return NextResponse.json({ ok: false, error: { code: "not_found", message: "Thread not found." } }, { status: 404 });
    return NextResponse.json({ ok: true, thread });
  } catch (e) {
    return NextResponse.json({ ok: false, error: { code: "fetch_failed", message: (e as Error).message } }, { status: 500 });
  }
}
