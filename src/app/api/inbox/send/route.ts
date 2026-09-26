import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/inbox/send — connected Gmail and Outlook accounts are read-only.
 * MacroMail never sends from them; use Send (your SMTP account) instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "read_only",
        message:
          "Connected Gmail and Outlook accounts are read-only. MacroMail does not send from them. Use Send with your own SMTP account.",
      },
    },
    { status: 403 },
  );
}
