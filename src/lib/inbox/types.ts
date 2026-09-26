export type Provider = "gmail" | "outlook" | "imap" | "macromail";
export type AccountStatus = "connected" | "needs_auth" | "connecting" | "error";

export interface ConnectedAccount {
  id: string; // acct_…
  provider: Provider;
  email: string;
  label?: string;
  status: AccountStatus;
  color: string;
  createdAt: string;
  scopes?: string[];
  lastSync?: string | null;
}

export type AiLabel = "important" | "newsletter" | "action_needed" | "fyi" | "promotions";

export interface MailMessage {
  id: string;
  from: { name?: string; email: string };
  to: string[];
  date: string;
  bodyText: string;
  bodyHtml?: string;
}

export interface MailThread {
  id: string; // thr_…
  accountId: string;
  subject: string;
  participants: { name?: string; email: string }[];
  messages: MailMessage[];
  unread: boolean;
  labels: AiLabel[];
  snippet: string;
}

/** Per-account dot palette, assigned round-robin. */
export const ACCOUNT_COLORS = ["#5B8CFF", "#34E6B0", "#F5B544", "#9B6BFF", "#FF6B6B", "#7AA2FF"];

export const PROVIDER_META: Record<Provider, { name: string; badge: string; desc: string }> = {
  gmail: { name: "Gmail", badge: "OAuth", desc: "Connect a Google account via secure OAuth." },
  outlook: { name: "Outlook / Microsoft 365", badge: "OAuth", desc: "Connect a Microsoft account via OAuth." },
  imap: { name: "IMAP / SMTP", badge: "Manual", desc: "Any mailbox — Fastmail, iCloud, your own server." },
  macromail: { name: "MacroMail domain", badge: "Built-in", desc: "Send from a verified MacroMail sending domain." },
};

export const LABEL_META: Record<AiLabel, { name: string; tone: "accent" | "warn" | "neutral" | "mono" }> = {
  important: { name: "Important", tone: "accent" },
  action_needed: { name: "Action needed", tone: "warn" },
  newsletter: { name: "Newsletter", tone: "neutral" },
  promotions: { name: "Promotions", tone: "neutral" },
  fyi: { name: "FYI", tone: "mono" },
};
