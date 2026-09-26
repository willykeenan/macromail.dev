import { NextResponse } from "next/server";
import { authenticateKey } from "@/lib/api-keys";
import { keyFromRequest } from "@/lib/ai";
import { readJsonBody } from "@/lib/http/body";
import { MAX_MCP_BATCH } from "@/lib/limits";
import { MCP_TOOLS, MCP_TOOL_MAP, toolAllowedForScope } from "@/lib/mcp/tools";
import { MACROMAIL_VERSION } from "@/lib/version";

export const runtime = "nodejs";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = {
  name: "macromail",
  title: "MacroMail",
  version: MACROMAIL_VERSION,
};
const INSTRUCTIONS =
  "MacroMail is a self-hosted email tool for AI agents. " +
  "send_email uses the account owner's SMTP credentials (never the server owner's mailbox). " +
  "Hosted mailboxes receive only internal MacroMail-to-MacroMail delivery — internet inbound is not available. " +
  "Gmail/Outlook connect is read-only and only when OAuth env vars are set. " +
  "AI tools use the user's own Anthropic key: the one saved in Settings, or the x-anthropic-key request header.";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, mcp-session-id, mcp-protocol-version, x-anthropic-key, x-api-key",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

const ok = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
const err = (id: JsonRpcId, code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id,
  error: { code, message },
});

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/** Friendly response for humans / discovery probes hitting the endpoint with GET. */
export function GET() {
  return NextResponse.json(
    {
      service: "MacroMail MCP",
      version: MACROMAIL_VERSION,
      transport: "Streamable HTTP (JSON-RPC 2.0)",
      protocol: PROTOCOL_VERSION,
      how_to_use:
        "POST JSON-RPC to this URL with header `Authorization: Bearer mm_live_…`. Add it as a remote MCP server in Claude, ChatGPT, Cursor, or any MCP client.",
      tools: MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    },
    { headers: CORS },
  );
}

export async function POST(req: Request) {
  const read = await readJsonBody(req);
  if (!read.ok) {
    return NextResponse.json(
      err(null, read.status === 413 ? -32600 : -32700, read.status === 413 ? read.message : "Parse error: body must be JSON."),
      { status: read.status, headers: CORS },
    );
  }
  const payload = read.value;

  const requests = Array.isArray(payload) ? payload : [payload];
  if (requests.length === 0 || requests.length > MAX_MCP_BATCH) {
    return NextResponse.json(
      err(null, -32600, `Invalid Request: a batch must hold 1 to ${MAX_MCP_BATCH} requests.`),
      { status: 400, headers: CORS },
    );
  }
  const anthropicKey = keyFromRequest(req);
  let authedCache: Awaited<ReturnType<typeof authenticateKey>> | undefined;
  const authed = async () => {
    if (authedCache === undefined) authedCache = await authenticateKey(req);
    return authedCache;
  };
  const responses: unknown[] = [];

  for (const raw of requests) {
    const r = raw as JsonRpcRequest;
    const id = r?.id ?? null;
    const isNotification = r?.id === undefined;

    try {
      switch (r?.method) {
        case "initialize": {
          const clientProtocol = (r.params?.protocolVersion as string) || PROTOCOL_VERSION;
          responses.push(
            ok(id, {
              protocolVersion: clientProtocol,
              capabilities: { tools: { listChanged: false } },
              serverInfo: SERVER_INFO,
              instructions: INSTRUCTIONS,
            }),
          );
          break;
        }
        case "notifications/initialized":
        case "notifications/cancelled":
          // Notifications: no response.
          break;
        case "ping":
          responses.push(ok(id, {}));
          break;
        case "tools/list":
          responses.push(
            ok(id, {
              tools: MCP_TOOLS.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            }),
          );
          break;
        case "tools/call": {
          const key = await authed();
          if (!key) {
            // Surface as a tool error so agents see a clear, actionable message.
            responses.push(
              ok(id, {
                content: [
                  {
                    type: "text",
                    text: "Authentication required. Add header `Authorization: Bearer mm_live_…` with a MacroMail API key (create one in the dashboard → API keys).",
                  },
                ],
                isError: true,
              }),
            );
            break;
          }
          const name = typeof r.params?.name === "string" ? r.params.name : "";
          const rawArgs = r.params?.arguments;
          const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {};
          const tool = MCP_TOOL_MAP[name];
          if (!tool || !Object.prototype.hasOwnProperty.call(MCP_TOOL_MAP, name)) {
            responses.push(err(id, -32602, `Unknown tool: ${name.slice(0, 100)}`));
            break;
          }
          if (!toolAllowedForScope(name, key.scope)) {
            responses.push(
              ok(id, {
                content: [
                  { type: "text", text: `This API key (scope: ${key.scope}) cannot call ${name}. Use a full-access key.` },
                ],
                isError: true,
              }),
            );
            break;
          }
          try {
            const result = await tool.handler(key, args, { anthropicKey });
            responses.push(
              ok(id, {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                structuredContent: result,
                isError: false,
              }),
            );
          } catch (e) {
            responses.push(
              ok(id, {
                content: [{ type: "text", text: e instanceof Error ? e.message : "Tool error." }],
                isError: true,
              }),
            );
          }
          break;
        }
        default:
          if (!isNotification) responses.push(err(id, -32601, `Method not found: ${String(r?.method).slice(0, 100)}`));
      }
    } catch (e) {
      if (!isNotification) responses.push(err(id, -32603, e instanceof Error ? e.message : "Internal error."));
    }
  }

  // All-notification batch → 202 with no body (per spec).
  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers: CORS });
  }

  const out = Array.isArray(payload) ? responses : responses[0];
  return NextResponse.json(out, { headers: CORS });
}
