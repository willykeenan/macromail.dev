import type { AuthedKey } from "@/lib/api-keys";
import {
  countDomainsForUser,
  getEmailForUser,
  listEmailsForUser,
  listDomainsForUser,
  upsertDomain,
} from "@/lib/db";
import { MAX_DOMAINS_PER_USER } from "@/lib/limits";
import { id } from "@/lib/ids";
import { sendAndLog } from "@/lib/email/send";
import { normalizeSend, sendSchema } from "@/lib/email/schema";
import {
  createMailbox,
  INBOUND_NOTE,
  listMailboxes,
  listMailboxMessages,
  mailboxDomains,
  markMailboxMessagesRead,
} from "@/lib/mailboxes";
import type { DomainRow } from "@/lib/types/db";

/** Per-request context from the MCP transport. */
export interface McpContext {
  /** Bring-your-own Anthropic key from the x-anthropic-key request header. */
  anthropicKey?: string | null;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Returns a JSON-serializable result; the transport wraps it as MCP content. */
  handler: (authed: AuthedKey, args: Record<string, unknown>, ctx?: McpContext) => Promise<unknown>;
}

const recipients = {
  anyOf: [
    { type: "string", description: "A single email address" },
    { type: "array", items: { type: "string" } },
  ],
  description: "Recipient(s): a string or array of email addresses.",
};

export const MCP_TOOLS: McpTool[] = [
  {
    name: "send_email",
    description:
      "Send an email through this account's own SMTP credentials. Recipients on this server's mailbox domains are delivered internally instead, and require From to be one of your own mailboxes. Internet inbound is not available. MacroMail never sends from the server owner's mailbox.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Sender, e.g. 'Acme <hello@acme.com>'." },
        to: recipients,
        subject: { type: "string" },
        html: { type: "string", description: "HTML body (provide html or text)." },
        text: { type: "string", description: "Plain-text body (provide html or text)." },
        cc: recipients,
        bcc: recipients,
        reply_to: { type: "string" },
        internal_only: {
          type: "boolean",
          description: "Refuse the send unless every recipient is a MacroMail mailbox address.",
        },
      },
      required: ["from", "to", "subject"],
    },
    handler: async (authed, args) => {
      const parsed = sendSchema.safeParse(args);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid send_email arguments.");
      }
      const result = await sendAndLog({
        ...normalizeSend(parsed.data),
        userId: authed.userId,
        apiKeyId: authed.keyId,
        apiKeyEnv: authed.env,
        source: "mcp",
      });
      if (result.status === "failed") {
        throw new Error(result.error ?? "Failed to send email.");
      }
      return result;
    },
  },
  {
    name: "list_emails",
    description: "List the most recent emails sent from this MacroMail account.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max rows (default 20, max 100)." } },
    },
    handler: async (authed, args) => {
      const limit = Math.min(Number(args.limit) || 20, 100);
      const data = listEmailsForUser(authed.userId, limit);
      return {
        count: data.length,
        emails: data.map((e) => ({
          id: e.id,
          from: e.from_addr,
          to: e.to_addrs,
          subject: e.subject,
          status: e.status,
          simulated: e.simulated,
          created_at: e.created_at,
        })),
      };
    },
  },
  {
    name: "get_email",
    description: "Retrieve a single sent email by its id (em_…), including body and delivery status.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Email id, e.g. em_abc123" } },
      required: ["id"],
    },
    handler: async (authed, args) => {
      const data = getEmailForUser(authed.userId, String(args.id ?? "").slice(0, 100));
      if (!data) throw new Error(`No email with id ${args.id}.`);
      return data;
    },
  },
  {
    name: "list_domains",
    description: "List sending-domain records stored for this account. Outbound still uses the user's SMTP account.",
    inputSchema: { type: "object", properties: {} },
    handler: async (authed) => {
      const data = listDomainsForUser(authed.userId);
      return { count: data.length, domains: data };
    },
  },
  {
    name: "create_domain",
    description:
      "Record a sending domain for this account. DNS/SES provisioning is not used; outbound email goes through the user's SMTP account.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Domain, e.g. mail.acme.com" } },
      required: ["name"],
    },
    handler: async (authed, args) => {
      const domain = String(args.name || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "");
      if (!domain || domain.length > 253 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        throw new Error("Enter a valid domain, e.g. mail.acme.com");
      }
      const existing = listDomainsForUser(authed.userId).some((d) => d.domain === domain);
      if (!existing && countDomainsForUser(authed.userId) >= MAX_DOMAINS_PER_USER) {
        throw new Error(`An account can record at most ${MAX_DOMAINS_PER_USER} domains.`);
      }
      const row: DomainRow = {
        id: id("dom"),
        user_id: authed.userId,
        domain,
        status: "pending",
        region: "smtp",
        records: [
          { type: "TXT", name: domain, value: `v=spf1 include:${domain} ~all`, purpose: "SPF" },
        ],
        verified_at: null,
        created_at: new Date().toISOString(),
      };
      upsertDomain(row);
      return {
        ...row,
        note: "Domain recorded locally. Outbound email uses your SMTP account, not this DNS record.",
      };
    },
  },

  /* ───────────────────────── Inbox tools (connected Gmail/Outlook) ───────────────────────── */
  {
    name: "list_accounts",
    description:
      "List the email accounts (Gmail/Outlook) connected to this MacroMail user's inbox. Connect is read-only and only available when OAuth env vars are set.",
    inputSchema: { type: "object", properties: {} },
    handler: async (authed) => {
      const { listAccounts } = await import("@/lib/inbox/service");
      const accounts = await listAccounts(authed.userId);
      return {
        count: accounts.length,
        accounts: accounts.map((a) => ({ id: a.id, provider: a.provider, email: a.email, status: a.status })),
        note:
          accounts.length === 0
            ? "No inbox accounts connected. Connect Gmail or Outlook in the dashboard → Accounts (only when OAuth is configured)."
            : undefined,
      };
    },
  },
  {
    name: "search_inbox",
    description:
      "Search/list email threads across the user's connected inbox accounts. Returns thread ids you can pass to read_thread or draft_reply.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional search query (provider search syntax)." },
        account_id: { type: "string", description: "Optional: restrict to one connected account (acct_…)." },
        limit: { type: "number", description: "Max threads (default 20)." },
      },
    },
    handler: async (authed, args) => {
      const { listThreads } = await import("@/lib/inbox/service");
      const threads = await listThreads(authed.userId, {
        query: args.query ? String(args.query) : undefined,
        accountId: args.account_id ? String(args.account_id) : undefined,
        limit: Math.min(Number(args.limit) || 20, 50),
      });
      return {
        count: threads.length,
        threads: threads.map((t) => ({
          thread_id: t.id,
          subject: t.subject,
          from: t.participants[0]?.email,
          snippet: t.snippet,
          unread: t.unread,
          labels: t.labels,
        })),
      };
    },
  },
  {
    name: "read_thread",
    description: "Read a full email thread (all messages) by its thread id (from search_inbox).",
    inputSchema: {
      type: "object",
      properties: { thread_id: { type: "string", description: "Composite thread id, e.g. acct_x::169abc" } },
      required: ["thread_id"],
    },
    handler: async (authed, args) => {
      const { getThread } = await import("@/lib/inbox/service");
      const thread = await getThread(authed.userId, String(args.thread_id));
      if (!thread) throw new Error("Thread not found (or the account is no longer connected).");
      return {
        subject: thread.subject,
        participants: thread.participants,
        messages: thread.messages.map((m) => ({ from: m.from, date: m.date, body: m.bodyText })),
      };
    },
  },
  {
    name: "triage_inbox",
    description:
      "Run AI triage across recent threads: classify each by intent (important/action_needed/newsletter/promotions/fyi) with a one-line summary. Uses the user's own Anthropic key (saved in Settings, or the x-anthropic-key header).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "How many recent threads to triage (default 20)." } },
    },
    handler: async (authed, args, ctx) => {
      const { listThreads, triageThreads, resolveUserAnthropicKey } = await import("@/lib/inbox/service");
      const threads = await listThreads(authed.userId, { limit: Math.min(Number(args.limit) || 20, 40) });
      const key = await resolveUserAnthropicKey(authed.userId, ctx?.anthropicKey);
      const result = await triageThreads(authed.userId, threads, key);
      if (Object.keys(result).length === 0) {
        return { triaged: 0, note: "AI is not configured (no Anthropic key) or there are no threads to triage." };
      }
      return {
        triaged: Object.keys(result).length,
        threads: threads
          .filter((t) => result[t.id])
          .map((t) => ({ thread_id: t.id, subject: t.subject, ...result[t.id] })),
      };
    },
  },
  {
    name: "draft_reply",
    description:
      "Draft (but do not send) a reply to a thread. Returns the proposed reply body for review. Uses the user's own Anthropic key (saved in Settings, or the x-anthropic-key header). Gmail/Outlook connect is read-only.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        instructions: { type: "string", description: "Optional guidance, e.g. 'politely decline'." },
      },
      required: ["thread_id"],
    },
    handler: async (authed, args, ctx) => {
      const { draftReply, resolveUserAnthropicKey } = await import("@/lib/inbox/service");
      const key = await resolveUserAnthropicKey(authed.userId, ctx?.anthropicKey);
      const draft = await draftReply(authed.userId, String(args.thread_id), args.instructions ? String(args.instructions) : undefined, key);
      return { thread_id: args.thread_id, draft };
    },
  },
  {
    name: "create_mailbox",
    description:
      "Create a MacroMail-hosted receiving address on one of this server's mailbox domains (see list_mailboxes → allowed_domains). Internet inbound is not available; mailboxes only receive internal delivery from other MacroMail mailboxes.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "The address to claim on an allowed domain, e.g. 'agent@example.com'." },
        display_name: { type: "string", description: "Optional display name." },
      },
      required: ["address"],
    },
    handler: async (authed, args) => {
      const result = await createMailbox(
        authed.userId,
        String(args.address || ""),
        args.display_name ? String(args.display_name) : null,
      );
      if (result.error) throw new Error(result.error);
      return result;
    },
  },
  {
    name: "list_mailboxes",
    description: "List this account's MacroMail-hosted receiving addresses. Internet inbound is not available.",
    inputSchema: { type: "object", properties: {} },
    handler: async (authed) => {
      const mailboxes = await listMailboxes(authed.userId);
      return { mailboxes, allowed_domains: mailboxDomains(), inbound: "internal_only", note: INBOUND_NOTE };
    },
  },
  {
    name: "read_mailbox",
    description:
      "Read messages from a hosted mailbox (newest first). Set mark_read=true to mark returned messages as read. Internet inbound is not available.",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string" },
        unread_only: { type: "boolean", description: "Only unread messages (default false)." },
        limit: { type: "number", description: "Max messages (default 50, cap 100)." },
        mark_read: { type: "boolean", description: "Mark returned messages as read." },
      },
      required: ["address"],
    },
    handler: async (authed, args) => {
      const result = await listMailboxMessages(authed.userId, String(args.address), {
        unreadOnly: args.unread_only === true,
        limit: typeof args.limit === "number" ? args.limit : 50,
      });
      if (result.error) throw new Error(result.error);
      const messages = result.messages || [];
      let marked = 0;
      if (args.mark_read === true && messages.length) {
        const updated = await markMailboxMessagesRead(
          authed.userId,
          String(args.address),
          messages.map((m) => m.id),
        );
        marked = updated.updated ?? 0;
      }
      return {
        messages,
        marked_read: marked,
        inbound: "internal_only",
        note: INBOUND_NOTE,
      };
    },
  },
];

export const MCP_TOOL_MAP: Record<string, McpTool> = Object.fromEntries(
  MCP_TOOLS.map((t) => [t.name, t]),
);

/** Scope guard: sending_only keys may only send and inspect sent mail. */
export function toolAllowedForScope(tool: string, scope: AuthedKey["scope"]): boolean {
  if (scope === "full_access") return true;
  return tool === "send_email" || tool === "list_emails" || tool === "get_email";
}
