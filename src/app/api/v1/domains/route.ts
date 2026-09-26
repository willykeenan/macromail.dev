import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateKey, authErrorBody } from "@/lib/api-keys";
import { countDomainsForUser, listDomainsForUser, upsertDomain } from "@/lib/db";
import { readJsonBody } from "@/lib/http/body";
import { MAX_DOMAINS_PER_USER } from "@/lib/limits";
import { id } from "@/lib/ids";
import type { DomainRow } from "@/lib/types/db";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, "Enter a valid domain, e.g. mail.acme.com"),
  region: z.string().max(32).optional(),
});

/** GET /v1/domains — list sending domains. */
export async function GET(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });

  const data = listDomainsForUser(authed.userId);
  return NextResponse.json({ object: "list", data });
}

/** POST /v1/domains — record a sending domain. Outbound uses the user's SMTP account. */
export async function POST(req: Request) {
  const authed = await authenticateKey(req);
  if (!authed) return NextResponse.json(authErrorBody(), { status: 401 });
  if (authed.scope !== "full_access") {
    return NextResponse.json(
      { error: { code: "insufficient_scope", message: "This key cannot manage domains. Use a full-access key." } },
      { status: 403 },
    );
  }

  const read = await readJsonBody(req);
  if (!read.ok) {
    return NextResponse.json(
      { error: { code: read.status === 413 ? "payload_too_large" : "validation_error", message: read.message } },
      { status: read.status === 413 ? 413 : 422 },
    );
  }
  const parsed = createSchema.safeParse(read.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid domain." } },
      { status: 422 },
    );
  }

  const domain = parsed.data.name.toLowerCase();
  const existing = listDomainsForUser(authed.userId).some((d) => d.domain === domain);
  if (!existing && countDomainsForUser(authed.userId) >= MAX_DOMAINS_PER_USER) {
    return NextResponse.json(
      { error: { code: "limit_reached", message: `An account can record at most ${MAX_DOMAINS_PER_USER} domains.` } },
      { status: 429 },
    );
  }
  const row: DomainRow = {
    id: id("dom"),
    user_id: authed.userId,
    domain,
    status: "pending",
    region: parsed.data.region ?? "smtp",
    records: [{ type: "TXT", name: domain, value: `v=spf1 include:${domain} ~all`, purpose: "SPF" }],
    verified_at: null,
    created_at: new Date().toISOString(),
  };

  upsertDomain(row);

  return NextResponse.json(
    {
      id: row.id,
      domain: row.domain,
      status: row.status,
      region: row.region,
      records: row.records,
      live: false,
      note: "Domain recorded locally. Outbound email uses your SMTP account, not SES.",
    },
    { status: 200 },
  );
}
