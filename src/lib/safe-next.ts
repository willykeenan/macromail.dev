/**
 * Keep every post-auth navigation inside MacroMail's authenticated product.
 *
 * MacroMail shares an identity provider with other K&E products. A raw `next`
 * value must therefore never be allowed to turn a successful MacroMail login
 * into a cross-product (or arbitrary external) redirect.
 */
export const DEFAULT_POST_AUTH_PATH = "/app/overview";

const MAX_NEXT_LENGTH = 2_048;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export function safePostAuthPath(
  candidate: string | null | undefined,
  fallback = DEFAULT_POST_AUTH_PATH,
): string {
  if (typeof candidate !== "string" || !candidate) return fallback;
  if (
    candidate !== candidate.trim() ||
    candidate.length > MAX_NEXT_LENGTH ||
    CONTROL_OR_SPACE.test(candidate) ||
    candidate.includes("\\") ||
    ENCODED_PATH_SEPARATOR.test(candidate) ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//")
  ) {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, "https://macromail.invalid");
  } catch {
    return fallback;
  }

  if (
    parsed.origin !== "https://macromail.invalid" ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== "/app" && !parsed.pathname.startsWith("/app/"))
  ) {
    return fallback;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return fallback;
  }
  if (
    decodedPath.includes("\\") ||
    CONTROL_OR_SPACE.test(decodedPath) ||
    decodedPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
