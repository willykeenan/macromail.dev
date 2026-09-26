import { NextResponse } from "next/server";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { readJsonBody } from "@/lib/http/body";
import {
  listMailboxMessages,
  markMailboxMessagesRead,
} from "@/lib/mailboxes";

export const runtime = "nodejs";

function scopeError() {
  return NextResponse.json(
    {
      error: {
        code: "insufficient_scope",
        message: "Mailboxes require a full_access API key.",
        fix: "Create a full-access key in the dashboard and retry.",
      },
    },
    { status: 403 },
  );
}

/** GET /v1/mailboxes/:address/messages — poll a hosted mailbox. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope === "sending_only") return scopeError();

  const { address } = await params;
  const url = new URL(req.url);
  const result = await listMailboxMessages(
    authed.userId,
    decodeURIComponent(address),
    {
      since: url.searchParams.get("since") || undefined,
      unreadOnly: url.searchParams.get("unread") === "1",
      limit: parseInt(url.searchParams.get("limit") || "50", 10) || 50,
    },
  );
  if (result.error) {
    return NextResponse.json(
      { error: { code: "not_found", message: result.error } },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: result.messages }, { status: 200 });
}

/** PATCH /v1/mailboxes/:address/messages — mark messages read. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope === "sending_only") return scopeError();

  const { address } = await params;
  const read = await readJsonBody(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    const tooLarge = !read.ok && read.status === 413;
    return NextResponse.json(
      {
        error: {
          code: tooLarge ? "payload_too_large" : "validation_error",
          message: tooLarge ? read.message : "Request body must be valid JSON.",
          fix: "Provide { ids: [\"mbm_…\"] }.",
        },
      },
      { status: tooLarge ? 413 : 422 },
    );
  }
  const body = read.value as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100).map(String) : [];
  const result = await markMailboxMessagesRead(
    authed.userId,
    decodeURIComponent(address),
    ids,
  );
  if (result.error) {
    return NextResponse.json(
      { error: { code: "not_found", message: result.error } },
      { status: 404 },
    );
  }
  return NextResponse.json({ updated: result.updated }, { status: 200 });
}
