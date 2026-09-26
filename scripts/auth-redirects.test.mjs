import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_POST_AUTH_PATH,
  safePostAuthPath,
} from "../src/lib/safe-next.ts";

test("keeps valid MacroMail product destinations", () => {
  for (const [candidate, expected] of [
    ["/app", "/app"],
    ["/app/overview", "/app/overview"],
    ["/app/accounts?connected=1", "/app/accounts?connected=1"],
    ["/app/inbox#thread", "/app/inbox#thread"],
  ]) {
    assert.equal(safePostAuthPath(candidate), expected);
  }
});

test("refuses external and cross-product redirects", () => {
  for (const candidate of [
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "javascript:location='https://evil.example'",
    "data:text/html,redirect",
    "/pricing",
    "/login",
    "/auth/callback",
  ]) {
    assert.equal(safePostAuthPath(candidate), DEFAULT_POST_AUTH_PATH, candidate);
  }
});

test("refuses encoded traversal, separators, controls, and oversized input", () => {
  for (const candidate of [
    "/app/%2e%2e/login",
    "/app/%2F%2Fevil.example",
    "/app/%5cevil.example",
    "/app/overview%00",
    " /app/overview",
    "/app/overview ",
    `/app/${"x".repeat(2_100)}`,
  ]) {
    assert.equal(safePostAuthPath(candidate), DEFAULT_POST_AUTH_PATH, candidate.slice(0, 80));
  }
});

test("uses a caller-supplied internal fallback without trusting the candidate", () => {
  assert.equal(safePostAuthPath("https://evil.example", "/app/inbox"), "/app/inbox");
});
