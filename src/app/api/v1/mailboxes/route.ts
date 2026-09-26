import { NextResponse } from "next/server";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { readJsonBody } from "@/lib/http/body";
import { createMailbox, listMailboxes, mailboxDomains } from "@/lib/mailboxes";

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

/** POST /v1/mailboxes — register a hosted receiving address. */
export async function POST(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope === "sending_only") return scopeError();

  const read = await readJsonBody(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    const tooLarge = !read.ok && read.status === 413;
    return NextResponse.json(
      {
        error: {
          code: tooLarge ? "payload_too_large" : "validation_error",
          message: tooLarge ? read.message : "Request body must be valid JSON.",
          fix: "Provide { address, display_name? }.",
        },
      },
      { status: tooLarge ? 413 : 422 },
    );
  }
  const body = read.value as { address?: unknown; display_name?: unknown };

  const result = await createMailbox(
    authed.userId,
    typeof body.address === "string" ? body.address : "",
    typeof body.display_name === "string" ? body.display_name : null,
  );
  if (result.error) {
    const status =
      result.code === "address_taken" ? 409 : result.code === "domain_not_allowed" ? 403 : result.code === "limit_reached" ? 429 : 422;
    return NextResponse.json(
      {
        error: {
          code: result.code ?? "mailbox_error",
          message: result.error,
          ...(result.code === "domain_not_allowed" ? { allowed_domains: mailboxDomains() } : {}),
        },
      },
      { status },
    );
  }
  return NextResponse.json(
    { mailbox: result.mailbox, existing: result.existing ?? false },
    { status: result.existing ? 200 : 201 },
  );
}

/** GET /v1/mailboxes — list this account's hosted mailboxes. */
export async function GET(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope === "sending_only") return scopeError();

  const mailboxes = await listMailboxes(authed.userId);
  return NextResponse.json({ data: mailboxes, allowed_domains: mailboxDomains() }, { status: 200 });
}
