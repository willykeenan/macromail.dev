import { NextResponse } from "next/server";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { getEmailForUser } from "@/lib/db";

export const runtime = "nodejs";

/** GET /v1/emails/:id — retrieve a single sent email. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const { id } = await params;
  const data = getEmailForUser(authed.userId, id);

  if (!data) {
    return NextResponse.json(
      { error: { code: "not_found", message: `No email with id ${id}.` } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    id: data.id,
    from: data.from_addr,
    to: data.to_addrs,
    cc: data.cc,
    bcc: data.bcc,
    reply_to: data.reply_to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    tags: data.tags,
    status: data.status,
    simulated: data.simulated,
    provider: data.provider,
    provider_message_id: data.provider_message_id,
    error: data.error,
    created_at: data.created_at,
  });
}
