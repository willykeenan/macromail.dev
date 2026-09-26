import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionCookie } from "@/lib/session-cookie";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = pathname === "/app" || pathname.startsWith("/app/");
  if (!isProtected) return NextResponse.next();

  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = raw ? await verifySessionCookie(raw) : null;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on app routes to gate the dashboard, but skip
     * static assets, the public API (key-authenticated), and the MCP endpoint.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|txt|ico)$).*)",
  ],
};
