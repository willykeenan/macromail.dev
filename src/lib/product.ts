import { restEndpoints } from "@/lib/content";
import { mailboxDomains } from "@/lib/mailboxes";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { site } from "@/lib/site";
import { MACROMAIL_VERSION } from "@/lib/version";

export { MACROMAIL_VERSION };

/** Public origin of this request, as the client addressed it. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(/:$/, "");
  const safeHost = /^[a-z0-9.-]+(?::\d+)?$/i.test(host) ? host : url.host;
  const safeProto = proto === "https" || proto === "http" ? proto : "https";
  return `${safeProto}://${safeHost}`;
}

/**
 * Public discovery document for agents. Static product facts only: no
 * account, mailbox, credential, or runtime data.
 */
export function agentContract(origin: string) {
  return {
    name: site.name,
    id: "macromail",
    version: MACROMAIL_VERSION,
    description: site.tagline,
    license: site.license,
    source: site.github,
    docs: `${origin}/docs`,
    llms_txt: `${origin}/llms.txt`,
    auth: {
      type: "bearer",
      header: "Authorization: Bearer mm_live_…",
      keys_page: `${origin}/app/api-keys`,
      test_keys: "mm_test_ keys simulate every send, including internal delivery.",
    },
    rest: {
      base: `${origin}/api/v1`,
      endpoints: restEndpoints.map((e) => ({ method: e.method, path: e.path })),
    },
    mcp: {
      url: `${origin}/api/mcp`,
      transport: "streamable-http",
      tools: MCP_TOOLS.map((t) => t.name),
      anthropic_key_header: "x-anthropic-key",
    },
    mailboxes: {
      inbound: "internal_only",
      domains: mailboxDomains(),
      note: "Internet inbound is not available. Mailboxes receive mail sent through this server to one of its mailbox domains.",
    },
    outbound: "The account's own SMTP credentials (set in /app/settings). Never the server owner's mailbox.",
  };
}
