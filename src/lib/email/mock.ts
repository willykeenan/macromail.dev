import type { EmailProvider, SendEmailInput } from "./types";

/**
 * Simulated provider used when a test API key is used or SMTP is unavailable.
 * It does NOT silently pretend an email was delivered — the API route surfaces
 * `simulated: true` so the dashboard and agents can be honest about it.
 */
export class MockProvider implements EmailProvider {
  readonly name: string;
  readonly live = false;

  constructor(name = "Simulated (no SMTP configured)") {
    this.name = name;
  }

  async send(_input: SendEmailInput): Promise<{ provider_message_id: string }> {
    return { provider_message_id: `simulated-${Date.now().toString(36)}` };
  }
}
