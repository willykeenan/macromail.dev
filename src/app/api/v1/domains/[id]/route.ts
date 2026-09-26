import { NextResponse } from "next/server";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { deleteDomainForUser, getDomainForUser } from "@/lib/db";

export const runtime = "nodejs";

/** GET /v1/domains/:id — fetch a stored domain record. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const { id } = await params;
  const row = getDomainForUser(authed.userId, id);

  if (!row) {
    return NextResponse.json({ error: { code: "not_found", message: "Domain not found." } }, { status: 404 });
  }

  return NextResponse.json(row);
}

/** DELETE /v1/domains/:id — remove a domain. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope !== "full_access") {
    return NextResponse.json(
      { error: { code: "insufficient_scope", message: "This key cannot manage domains." } },
      { status: 403 },
    );
  }
  const { id } = await params;
  deleteDomainForUser(authed.userId, id);
  return NextResponse.json({ deleted: true, id });
}
