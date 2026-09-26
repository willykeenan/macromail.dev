/**
 * Same-origin checks for cookie-authenticated mutations (dashboard + login).
 * API-key routes (REST / MCP) skip this — agents often have no browser Origin.
 */

function requestHost(headersList: Headers): string | null {
  const raw = headersList.get("x-forwarded-host") || headersList.get("host");
  if (!raw) return null;
  return raw.split(",")[0]!.trim().toLowerCase();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

export function checkMutationOrigin(headersList: Headers): boolean {
  const host = requestHost(headersList);
  if (!host) return false;

  const origin = headersList.get("origin");
  if (origin) return hostOf(origin) === host;

  const referer = headersList.get("referer");
  if (referer) return hostOf(referer) === host;

  const site = (headersList.get("sec-fetch-site") || "").toLowerCase();
  if (site === "same-origin" || site === "same-site") return true;

  return false;
}

export function mutationOriginError() {
  return "Request origin is not allowed.";
}

export function requestOriginOk(req: Request): boolean {
  return checkMutationOrigin(req.headers);
}
