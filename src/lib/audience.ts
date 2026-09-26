/**
 * MacroMail has one public face: the self-hosted email tool.
 * There is no developer / personal audience toggle.
 */
export type Audience = "selfhost";

export const AUDIENCE_COOKIE = "mm_audience";

export function parseAudience(_value?: string | null): Audience {
  return "selfhost";
}
