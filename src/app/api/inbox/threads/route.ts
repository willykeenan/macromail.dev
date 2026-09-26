import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listThreads } from "@/lib/inbox/service";

export const runtime = "nodejs";

/** GET /api/inbox/threads?accountId=&query=&limit= — aggregated threads. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });

  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId") || undefined;
  const query = url.searchParams.get("query") || undefined;
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Math.min(50, Math.max(1, Number(limitRaw) || 25)) : undefined;

  try {
    const threads = await listThreads(user.id, { accountId, query, limit });
    return NextResponse.json({ ok: true, threads });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: { code: "fetch_failed", message: (e as Error).message } },
      { status: 500 },
    );
  }
}
