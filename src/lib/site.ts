export const site = {
  name: "MacroMail",
  domain: "macromail.dev",
  url: "https://macromail.dev",
  github: "https://github.com/willykeenan/macromail.dev",
  apiBase: "https://macromail.dev/api/v1",
  localOrigin: "http://localhost:3000",
  mcpUrl: "https://macromail.dev/api/mcp",
  localMcpUrl: "http://localhost:3000/api/mcp",
  docsBase: "https://macromail.dev/docs",
  tagline: "A free, open-source, self-hostable email tool for AI agents.",
  description:
    "MacroMail is a free, open-source, self-hostable email tool for AI agents. It runs on SQLite. Accounts, agent mailboxes, API keys, REST v1, and a working MCP endpoint are included. Outbound mail uses your SMTP account. Internet inbound is not available yet.",
  parent: { name: "KE Studios", url: "https://kestudios.dev" },
  license: "MIT",
};

export const mainNav = [
  { label: "What works", href: "/#what-works" },
  { label: "Self-host", href: "/#self-host" },
  { label: "Docs", href: "/docs" },
  { label: "GitHub", href: "https://github.com/willykeenan/macromail.dev" },
];

export const footerNav: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Home", href: "/" },
      { label: "What works today", href: "/#what-works" },
      { label: "Self-host", href: "/#self-host" },
      { label: "GitHub", href: "https://github.com/willykeenan/macromail.dev" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "REST v1", href: "/docs#rest" },
      { label: "MCP", href: "/docs#mcp" },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
];

/**
 * Connector configs for a MacroMail you run. Replace the origin if you
 * expose the app on a public hostname.
 */
export const mcpConfig = {
  url: "http://localhost:3000/api/mcp",
  claudeCli: `claude mcp add --transport http macromail http://localhost:3000/api/mcp \\
  --header "Authorization: Bearer mm_live_xxxxxxxxxxxx"`,
  claudeJson: `{
  "mcpServers": {
    "macromail": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer mm_live_xxxxxxxxxxxx" }
    }
  }
}`,
  chatgpt: `Name:  MacroMail
URL:   http://localhost:3000/api/mcp
Auth:  Bearer token  →  mm_live_xxxxxxxxxxxx`,
  mcpRemote: `npx -y mcp-remote http://localhost:3000/api/mcp \\
  --header "Authorization: Bearer mm_live_xxxxxxxxxxxx"`,
};

export const agentTargets = [
  { id: "claude", name: "Claude / Claude Code", file: "Remote MCP (HTTP)" },
  { id: "chatgpt", name: "ChatGPT", file: "Connectors → Add" },
  { id: "cursor", name: "Cursor", file: ".cursor/mcp.json" },
];
