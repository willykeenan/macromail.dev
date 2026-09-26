/** Row shapes for MacroMail's SQLite tables. */

export type KeyScope = "full_access" | "sending_only";
export type KeyEnv = "live" | "test";

export interface ApiKeyRow {
  id: string; // key_…
  user_id: string;
  name: string;
  prefix: string; // e.g. "mm_live_8f3a…" (display only)
  token_hash: string; // sha256(full token)
  scope: KeyScope;
  env: KeyEnv;
  last_used_at: string | null;
  created_at: string;
}

export interface EmailRow {
  id: string; // em_…
  user_id: string;
  api_key_id: string | null;
  from_addr: string;
  to_addrs: string[];
  cc: string[] | null;
  bcc: string[] | null;
  reply_to: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  tags: { name: string; value: string }[] | null;
  status: string;
  provider: string;
  provider_message_id: string | null;
  simulated: boolean;
  error: string | null;
  source: "api" | "mcp" | "dashboard";
  created_at: string;
}

export type DomainStatus = "pending" | "verified" | "failed";

export interface DomainRow {
  id: string; // dom_…
  user_id: string;
  domain: string;
  status: DomainStatus;
  region: string;
  records: DnsRecord[] | null;
  verified_at: string | null;
  created_at: string;
}

export interface DnsRecord {
  type: "TXT" | "CNAME" | "MX";
  name: string;
  value: string;
  purpose: string; // "DKIM" | "SPF" | "DMARC" | "MAIL FROM"
}

export type InboxProvider = "gmail" | "outlook" | "imap";

export interface ConnectedAccountRow {
  id: string; // acct_…
  user_id: string;
  provider: InboxProvider;
  email: string;
  label: string | null;
  status: "connected" | "needs_auth" | "error";
  color: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string[] | null;
  sync_cursor: string | null; // gmail historyId / graph delta token
  last_sync_at: string | null;
  created_at: string;
}

export interface ThreadAiRow {
  account_id: string;
  provider_thread_id: string;
  labels: string[];
  summary: string | null;
  updated_at: string;
}

export interface ProfileRow {
  id: string; // = auth.users.id
  email: string | null;
  plan: "free" | "pro" | "scale";
  anthropic_key_enc: string | null;
  default_from: string | null;
  created_at: string;
}

/** A MacroMail-hosted receiving address (e.g. an agent's inbox). */
export interface MailboxRow {
  id: string; // mbx_…
  user_id: string;
  address: string; // normalized lowercase
  display_name: string | null;
  created_at: string;
}

/** One delivered message inside a hosted mailbox. */
export interface MailboxMessageRow {
  id: string; // mbm_…
  mailbox_id: string;
  user_id: string; // mailbox owner (denormalized for RLS)
  email_id: string | null; // source emails.id for internal delivery
  from_addr: string;
  from_name: string | null;
  to_addrs: string[];
  subject: string;
  text: string | null;
  html: string | null;
  read: boolean;
  created_at: string;
}
