export type EmailStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced"
  | "complained"
  | "delivery_delayed"
  | "canceled"
  | "scheduled";

export interface SendEmailInput {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  tags?: { name: string; value: string }[];
  /**
   * Refuse the send unless every recipient is a MacroMail mailbox address, so
   * nothing can leave through SMTP. For agent-to-agent traffic.
   */
  internal_only?: boolean;
  /**
   * SMTP envelope recipients (RCPT TO). Defaults to to + cc + bcc. sendAndLog
   * passes only the recipients outside this server's mailbox domains.
   */
  envelope_to?: string[];
}

export interface SendEmailResult {
  id: string;
  status: Extract<EmailStatus, "queued" | "scheduled">;
  created_at: string;
  provider_message_id?: string;
}

export interface EmailProvider {
  /** Human label for the active provider (shown honestly in the dashboard). */
  readonly name: string;
  /** Whether real credentials are configured. When false, sends are simulated. */
  readonly live: boolean;
  send(input: SendEmailInput): Promise<{ provider_message_id: string }>;
}
