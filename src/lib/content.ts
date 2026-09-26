import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Inbox,
  KeyRound,
  LockKeyhole,
  Mail,
  Server,
  Sparkles,
  Terminal,
} from "lucide-react";

export interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** Capabilities that actually work in this codebase today. */
export const features: Feature[] = [
  {
    icon: KeyRound,
    title: "Accounts and API keys",
    body: "Sign up, sign in, and create Bearer keys on the API keys page (/app/api-keys). Keys authenticate REST v1 and the MCP endpoint.",
  },
  {
    icon: Inbox,
    title: "Agent mailboxes",
    body: "Create addresses on this server's own mailbox domains (MACROMAIL_MAILBOX_DOMAINS). Mail sent through MacroMail to another MacroMail mailbox is delivered internally. Internet inbound is not available.",
  },
  {
    icon: Terminal,
    title: "REST v1",
    body: "Send, list, and fetch mail; manage mailboxes and sending-domain records. Account routes take a Bearer API key. GET /api/v1/agent-contract is public.",
  },
  {
    icon: Bot,
    title: "Hosted MCP at /api/mcp",
    body: "A Streamable HTTP MCP server. Its tools work: send, list and read mail, mailboxes, domains, optional inbox search, triage, and drafts.",
  },
  {
    icon: Mail,
    title: "Outbound through your SMTP",
    body: "Live send uses the SMTP account you save in Settings (/app/settings). MacroMail never sends from the server owner’s mailbox. Test keys simulate.",
  },
  {
    icon: LockKeyhole,
    title: "Optional Gmail and Outlook",
    body: "Read-only connect when the server has Google or Microsoft OAuth env vars. IMAP is not shipped. Connect is not available without those vars.",
  },
  {
    icon: Sparkles,
    title: "AI triage and drafts",
    body: "Triage and draft replies with the Anthropic key you save in Settings or send as x-anthropic-key. There is no server-wide key.",
  },
  {
    icon: Server,
    title: "SQLite, on your machine",
    body: "Mail data lives in MACROMAIL_DATA_DIR. There is no hosted database to provision. MIT licensed.",
  },
];

export const selfHostCommands = `cp .env.example .env
npm ci
npm run dev`;

export const selfHostNotes = [
  "Copy .env.example, then set SESSION_SECRET and TOKEN_ENC_KEY (openssl rand -hex 32) before a production start.",
  "Open http://localhost:3000. npm run build && npm start is the production-like process on the same machine.",
  "Set MACROMAIL_MAILBOX_DOMAINS to the domains this server answers for. Google and Microsoft OAuth env vars are optional and only enable read-only inbox connect.",
  "Each account saves its own SMTP credentials and Anthropic key in Settings. There is no server-wide SMTP or Anthropic key.",
];

export interface RestEndpoint {
  method: string;
  path: string;
  purpose: string;
}

export const restEndpoints: RestEndpoint[] = [
  { method: "POST", path: "/api/v1/emails", purpose: "Send one email (SMTP or internal delivery)." },
  { method: "GET", path: "/api/v1/emails", purpose: "List recent emails for the key’s account." },
  { method: "GET", path: "/api/v1/emails/:id", purpose: "Fetch one sent email, including body and status." },
  { method: "POST", path: "/api/v1/emails/batch", purpose: "Send 1–100 emails in one call." },
  { method: "GET", path: "/api/v1/mailboxes", purpose: "List this account’s MacroMail mailboxes." },
  { method: "POST", path: "/api/v1/mailboxes", purpose: "Create a mailbox on one of this server’s mailbox domains. Internet inbound is not available." },
  { method: "GET", path: "/api/v1/mailboxes/:address/messages", purpose: "Read messages in a mailbox (newest first). Query: unread=1, limit, since." },
  { method: "PATCH", path: "/api/v1/mailboxes/:address/messages", purpose: "Mark mailbox messages read. Body: { ids: [\"mbm_…\"] }." },
  { method: "GET", path: "/api/v1/domains", purpose: "List sending-domain records stored for the account." },
  { method: "POST", path: "/api/v1/domains", purpose: "Record a sending domain. Outbound still uses your SMTP." },
  { method: "GET", path: "/api/v1/domains/:id", purpose: "Fetch one stored domain record." },
  { method: "DELETE", path: "/api/v1/domains/:id", purpose: "Delete a stored domain record." },
  { method: "GET", path: "/api/v1/agent-contract", purpose: "Public product discovery. No account data." },
];

export interface McpToolDoc {
  name: string;
  purpose: string;
}

export const mcpTools: McpToolDoc[] = [
  { name: "send_email", purpose: "Send through the account’s SMTP. Recipients that are MacroMail mailboxes are delivered internally." },
  { name: "list_emails", purpose: "List recent emails sent from this account." },
  { name: "get_email", purpose: "Retrieve one sent email by id (em_…)." },
  { name: "list_domains", purpose: "List stored sending-domain records." },
  { name: "create_domain", purpose: "Record a sending domain locally. DNS/SES provisioning is not used." },
  { name: "list_accounts", purpose: "List Gmail/Outlook accounts connected to this user (read-only). Connecting needs OAuth env vars." },
  { name: "search_inbox", purpose: "Search threads on connected inbox accounts." },
  { name: "read_thread", purpose: "Read a full thread by id from search_inbox." },
  { name: "triage_inbox", purpose: "Classify recent threads. Uses the user’s Anthropic key (Settings or x-anthropic-key)." },
  { name: "draft_reply", purpose: "Draft a reply. Does not send. Uses the user’s Anthropic key (Settings or x-anthropic-key)." },
  { name: "create_mailbox", purpose: "Create a MacroMail mailbox. Internet inbound is not available." },
  { name: "list_mailboxes", purpose: "List this account’s mailboxes." },
  { name: "read_mailbox", purpose: "Read mailbox messages. Optional mark_read." },
];

export const restSendSnippet = `curl -X POST http://localhost:3000/api/v1/emails \\
  -H "Authorization: Bearer $MACROMAIL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "Agent <agent@example.com>",
    "to": ["other-agent@example.com"],
    "subject": "Hello from MacroMail",
    "text": "Delivered internally: both addresses are MacroMail mailboxes you own or can reach."
  }'`;

export const mailboxSnippet = `curl -X POST http://localhost:3000/api/v1/mailboxes \\
  -H "Authorization: Bearer $MACROMAIL_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "address": "agent@example.com", "display_name": "Agent" }'`;

export const limits = [
  "Internet inbound is not available. There is no public MX. Mailboxes only receive mail sent through MacroMail to another MacroMail mailbox.",
  "Mailboxes can only be created on the server’s own mailbox domains (MACROMAIL_MAILBOX_DOMAINS, default example.com). Mail to or from a mailbox must come from one of your own mailboxes.",
  "Outbound internet mail uses the SMTP credentials you save. MacroMail never sends from the server owner’s mailbox.",
  "Gmail and Outlook connect is read-only, and only when GOOGLE_* or MICROSOFT_* env vars are set. IMAP is not shipped.",
  "AI triage and drafts need the Anthropic key you save in Settings or send as x-anthropic-key. They are skipped when no key is present.",
  "There is no published language SDK. Call REST or MCP over HTTP.",
];
