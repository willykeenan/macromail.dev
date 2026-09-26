import type { LucideIcon } from "lucide-react";
import { Bot, Mail, Plug, Server } from "lucide-react";

export type IntegrationCategory = "Agents" | "Email accounts" | "Send";

export interface Integration {
  name: string;
  desc: string;
  category: IntegrationCategory;
  icon: LucideIcon;
  status?: "live" | "optional";
}

export const integrationCategories: IntegrationCategory[] = [
  "Agents",
  "Email accounts",
  "Send",
];

/** Only connectors that exist in this codebase. */
export const integrations: Integration[] = [
  {
    name: "MCP",
    desc: "POST JSON-RPC to /api/mcp with a Bearer API key. Every tool in the server works.",
    category: "Agents",
    icon: Plug,
    status: "live",
  },
  {
    name: "Claude, Cursor, and other MCP clients",
    desc: "Point any MCP client at your MacroMail origin. There is no published install package.",
    category: "Agents",
    icon: Bot,
    status: "live",
  },
  {
    name: "Gmail",
    desc: "Read-only OAuth connect when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.",
    category: "Email accounts",
    icon: Mail,
    status: "optional",
  },
  {
    name: "Outlook / Microsoft 365",
    desc: "Read-only OAuth connect when MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set.",
    category: "Email accounts",
    icon: Mail,
    status: "optional",
  },
  {
    name: "Your SMTP account",
    desc: "Live outbound uses the SMTP host you save in Settings. Not the server owner’s mailbox.",
    category: "Send",
    icon: Server,
    status: "live",
  },
];
