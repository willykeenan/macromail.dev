import type { EmailProvider } from "./types";
import { MockProvider } from "./mock";
import { apiKeyForcesSimulation, type ApiKeyEnvironment } from "./provider-policy";

let cached: EmailProvider | null = null;
let testProvider: EmailProvider | null = null;

/**
 * Process-level provider is always simulated. Live outbound uses the user's
 * own SMTP account (see sendAndLog) — never the server owner's mailbox.
 */
export function getProvider(): EmailProvider {
  if (!cached) cached = new MockProvider();
  return cached;
}

/** Test API keys never inherit a live transport. */
export function getProviderForKeyEnvironment(env: ApiKeyEnvironment | undefined): EmailProvider {
  if (!apiKeyForcesSimulation(env)) return getProvider();
  if (!testProvider) testProvider = new MockProvider("Simulated (test API key)");
  return testProvider;
}

/** Test helper / hot-reload: drop cached provider after env changes. */
export function resetProviderCache(): void {
  cached = null;
  testProvider = null;
}

export type { EmailProvider } from "./types";
