import { agentContract, requestOrigin } from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public, static discovery only. Returns no account, mailbox, credential, or runtime data. */
export async function GET(req: Request) {
  return Response.json({ data: agentContract(requestOrigin(req)) }, { headers: { "Cache-Control": "no-store" } });
}
