import { randomBytes } from "node:crypto";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

function rand(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

/** Prefixed, URL-safe resource IDs (em_…, key_…, dom_…). */
export function id(
  prefix:
    | "em"
    | "key"
    | "dom"
    | "aud"
    | "con"
    | "bcast"
    | "tmpl"
    | "wh"
    | "acct"
    | "thr"
    | "mbx"
    | "mbm"
    | "usr"
    | "ses",
): string {
  return `${prefix}_${rand(24)}`;
}

/** A live/test API token: mm_live_… / mm_test_… */
export function apiToken(env: "live" | "test"): string {
  return `mm_${env}_${rand(32)}`;
}
