import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";
import { MACROMAIL_VERSION } from "@/lib/version";

export const runtime = "nodejs";

export async function GET() {
  let dbOk = false;
  try {
    dbOk = pingDb();
  } catch {
    dbOk = false;
  }
  return NextResponse.json(
    {
      status: dbOk ? "ok" : "error",
      service: "macromail",
      version: MACROMAIL_VERSION,
      db: dbOk ? "ok" : "error",
      capabilities: {
        authentication: "api_key_and_session",
        outbound: "user_smtp",
        inbound: "internal_only",
        agentContract: "/api/v1/agent-contract",
        mcp: "/api/mcp",
      },
      time: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
