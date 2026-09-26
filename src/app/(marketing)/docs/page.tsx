import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Button } from "@/components/ui/Button";
import {
  mailboxSnippet,
  mcpTools,
  restEndpoints,
  restSendSnippet,
  selfHostCommands,
  selfHostNotes,
} from "@/lib/content";
import { mcpConfig, site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Self-host MacroMail, call REST v1, and connect an agent to the MCP endpoint at /api/mcp.",
};

const toc = [
  { href: "#self-host", label: "Self-host" },
  { href: "#rest", label: "REST v1" },
  { href: "#mcp", label: "MCP" },
  { href: "#optional", label: "Optional connectors" },
];

export default function DocsPage() {
  return (
    <section className="relative pb-24 pt-16 sm:pt-20">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Documentation</Eyebrow>
          <h1 className="mt-4 text-balance text-[clamp(2.1rem,5vw,3rem)] font-[680] leading-[1.05] tracking-[-0.03em] text-fg">
            REST, MCP, and self-host
          </h1>
          <p className="mt-5 text-balance text-[16px] leading-relaxed text-fg-muted">
            MacroMail is a free, open-source email tool for AI agents. This page covers what the
            running app actually exposes. Source:{" "}
            <a href={site.github} className="text-accent-hi hover:underline">
              github.com/willykeenan/macromail.dev
            </a>
            .
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {toc.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full border border-border bg-bg-raised px-3 py-1.5 text-[12.5px] text-fg-muted hover:border-border-strong hover:text-fg"
              >
                {item.label}
              </a>
            ))}
          </div>
        </div>

        <article id="self-host" className="mx-auto mt-16 max-w-[880px] scroll-mt-24">
          <Card className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Eyebrow>Self-host</Eyebrow>
                <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">
                  Three commands on your machine
                </h2>
              </div>
              <Badge tone="neutral">SQLite</Badge>
            </div>
            <p className="mt-4 text-[14.5px] leading-relaxed text-fg-muted">
              Clone the repo, then run these from the project root. Mail data lives in{" "}
              <code className="font-mono text-[13px] text-accent-hi">MACROMAIL_DATA_DIR</code>{" "}
              (default <code className="font-mono text-[13px] text-accent-hi">./data</code>).
            </p>
            <div className="mt-5">
              <CodeBlock filename="terminal" tabs={[{ label: "terminal", code: selfHostCommands }]} />
            </div>
            <ul className="mt-5 space-y-2.5 text-[13.5px] leading-relaxed text-fg-muted">
              {selfHostNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
            <p className="mt-5 text-[13.5px] text-fg-muted">
              Docker and launchd notes live in{" "}
              <code className="font-mono text-[12.5px] text-accent-hi">docs/SELF-HOST.md</code> in
              the repo.
            </p>
          </Card>
        </article>

        <article id="rest" className="mx-auto mt-8 max-w-[880px] scroll-mt-24">
          <Card className="p-6 sm:p-8">
            <Eyebrow>REST v1</Eyebrow>
            <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">
              HTTP API, Bearer key
            </h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-fg-muted">
              Sign up, open API keys (/app/api-keys), and create a key. Send{" "}
              <code className="font-mono text-[13px] text-accent-hi">Authorization: Bearer mm_live_…</code>
              . Sending-only keys may send and inspect sent mail. Mailbox routes and domain writes
              need a full-access key.{" "}
              <code className="font-mono text-[13px] text-accent-hi">GET /api/v1/agent-contract</code> is
              public. Next.js 16 dynamic route{" "}
              <code className="font-mono text-[13px] text-accent-hi">params</code> are Promises.
            </p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-fg-faint">
                    <th className="pb-2 pr-3 font-medium">Method</th>
                    <th className="pb-2 pr-3 font-medium">Path</th>
                    <th className="pb-2 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {restEndpoints.map((row) => (
                    <tr key={row.method + row.path} className="border-b border-border/70">
                      <td className="py-2.5 pr-3 font-mono text-[12px] text-accent-hi">{row.method}</td>
                      <td className="py-2.5 pr-3 font-mono text-[12px] text-fg">{row.path}</td>
                      <td className="py-2.5 text-fg-muted">{row.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-6 grid gap-4">
              <CodeBlock tabs={[{ label: "send", code: restSendSnippet }]} />
              <CodeBlock tabs={[{ label: "mailbox", code: mailboxSnippet }]} />
            </div>
          </Card>
        </article>

        <article id="mcp" className="mx-auto mt-8 max-w-[880px] scroll-mt-24">
          <Card className="p-6 sm:p-8">
            <Eyebrow>MCP</Eyebrow>
            <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">
              Hosted endpoint at /api/mcp
            </h2>
            <p className="mt-4 text-[14.5px] leading-relaxed text-fg-muted">
              Streamable HTTP, JSON-RPC 2.0. POST to{" "}
              <code className="font-mono text-[13px] text-accent-hi">{mcpConfig.url}</code> with the
              same Bearer key. A GET on that URL lists the tools. Every tool below is implemented
              and runs.
            </p>
            <div className="mt-5">
              <CodeBlock
                tabs={[
                  { label: "mcp.json", code: mcpConfig.claudeJson },
                  { label: "Claude CLI", code: mcpConfig.claudeCli },
                ]}
              />
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-fg-faint">
                    <th className="pb-2 pr-3 font-medium">Tool</th>
                    <th className="pb-2 font-medium">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {mcpTools.map((tool) => (
                    <tr key={tool.name} className="border-b border-border/70">
                      <td className="py-2.5 pr-3 font-mono text-[12px] text-accent-hi">{tool.name}</td>
                      <td className="py-2.5 text-fg-muted">{tool.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </article>

        <article id="optional" className="mx-auto mt-8 max-w-[880px] scroll-mt-24">
          <Card className="p-6 sm:p-8">
            <Eyebrow>Optional</Eyebrow>
            <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">
              Gmail, Outlook, and AI
            </h2>
            <div className="mt-5 space-y-4 text-[14.5px] leading-relaxed text-fg-muted">
              <p>
                Gmail and Outlook connect is read-only. It is wired only when the process has
                <code className="mx-1 font-mono text-[13px] text-accent-hi">GOOGLE_CLIENT_ID</code>
                / <code className="font-mono text-[13px] text-accent-hi">GOOGLE_CLIENT_SECRET</code> or
                the Microsoft pair. Redirect URIs are{" "}
                <code className="font-mono text-[12.5px] text-accent-hi">{"{origin}/api/inbox/callback/google"}</code>{" "}
                and{" "}
                <code className="font-mono text-[12.5px] text-accent-hi">{"{origin}/api/inbox/callback/outlook"}</code>.
                IMAP is not shipped.
              </p>
              <p>
                AI triage and drafts use the Anthropic key you save in Settings (/app/settings), or
                one sent as the{" "}
                <code className="font-mono text-[13px] text-accent-hi">x-anthropic-key</code> header
                on REST and MCP calls. There is no server-wide key. Without a key, those tools
                return a note instead of inventing a result.
              </p>
              <p>
                Outbound mail that is not internal mailbox delivery needs the SMTP credentials you
                save in Settings (/app/settings). MacroMail never sends from the server owner’s
                mailbox.
              </p>
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button href={site.github} variant="primary">
                GitHub
              </Button>
              <Button href="/signup" variant="secondary">
                Create an account
              </Button>
            </div>
          </Card>
        </article>
      </Container>
    </section>
  );
}
