import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, GitFork } from "lucide-react";
import { Container, Eyebrow } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { features, limits, restSendSnippet, selfHostCommands } from "@/lib/content";
import { mcpConfig, site } from "@/lib/site";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden pb-16 pt-20 sm:pt-24">
        <Container className="flex flex-col items-center text-center">
          <span className="mb-7 inline-flex items-center gap-2 rounded-full border border-success/25 bg-success-bg px-3 py-1.5 text-[12.5px] text-success">
            <span className="size-1.5 rounded-full bg-success" />
            Free · Open source · Self-hostable
          </span>

          <h1 className="max-w-[18ch] text-balance text-[clamp(2.5rem,6.4vw,4.4rem)] font-[690] leading-[.98] tracking-[-0.045em] text-fg">
            Email for AI agents. <span className="text-gradient">Run it yourself.</span>
          </h1>

          <p className="mt-7 max-w-[58ch] text-balance text-[17px] leading-relaxed text-fg-muted sm:text-[18px]">
            MacroMail is a free, open-source, self-hostable email tool for AI agents. It runs on
            SQLite on a machine you control. Agents send and read mail through REST and MCP.
          </p>

          <div className="mt-9 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <Button href={site.github} size="lg" className="w-full sm:w-auto">
              <GitFork className="size-4" />
              github.com/willykeenan/macromail.dev
              <ArrowUpRight className="size-4" />
            </Button>
            <Button href="/docs" size="lg" variant="secondary" className="w-full sm:w-auto">
              Docs <ArrowRight className="size-4" />
            </Button>
          </div>
          <p className="mt-4 text-[12.5px] text-fg-faint">MIT licensed · no paid product · your data stays in your SQLite file</p>
        </Container>
      </section>

      <section id="self-host" className="scroll-mt-24 pb-8">
        <Container>
          <Card className="mx-auto w-full max-w-[860px] overflow-hidden p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <Eyebrow>Self-host in three commands</Eyebrow>
                <p className="mt-2 text-[13.5px] text-fg-muted">
                  Clone{" "}
                  <a href={site.github} className="font-medium text-accent-hi hover:underline">
                    github.com/willykeenan/macromail.dev
                  </a>
                  , then:
                </p>
              </div>
              <Badge tone="neutral">http://localhost:3000</Badge>
            </div>
            <CodeBlock compact filename="terminal" tabs={[{ label: "terminal", code: selfHostCommands }]} />
          </Card>
        </Container>
      </section>

      <section id="what-works" className="scroll-mt-24 py-16">
        <Container>
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>What works today</Eyebrow>
            <h2 className="mt-4 text-balance text-[clamp(1.9rem,4vw,2.7rem)] font-[680] tracking-[-0.03em] text-fg">
              The product as it exists today
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-fg-muted">
              This is the product as it exists in the repo. Nothing below is a roadmap item.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((item) => (
              <Card key={item.title} className="p-5">
                <span className="grid size-9 place-items-center rounded-[10px] bg-accent-bg text-accent-hi">
                  <item.icon className="size-4" />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold text-fg">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{item.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-8">
        <Container>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-6 sm:p-7">
              <Eyebrow>REST v1</Eyebrow>
              <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">Send with an API key</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
                Create a key on the API keys page after you sign up. Recipients that are MacroMail
                mailboxes are delivered internally. Other recipients need the SMTP account you save in
                Settings.
              </p>
              <div className="mt-5">
                <CodeBlock compact tabs={[{ label: "curl", code: restSendSnippet }]} />
              </div>
              <Link
                href="/docs#rest"
                className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent-hi hover:gap-2.5"
              >
                REST reference <ArrowRight className="size-4" />
              </Link>
            </Card>
            <Card className="p-6 sm:p-7">
              <Eyebrow>MCP</Eyebrow>
              <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">Point an agent at /api/mcp</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-fg-muted">
                The tools on this endpoint work. Authenticate with the same Bearer key. Internet inbound is not available. IMAP is not shipped.
              </p>
              <div className="mt-5">
                <CodeBlock compact tabs={[{ label: "mcp.json", code: mcpConfig.claudeJson }]} />
              </div>
              <Link
                href="/docs#mcp"
                className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-accent-hi hover:gap-2.5"
              >
                MCP tools <ArrowRight className="size-4" />
              </Link>
            </Card>
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <Card className="p-7 sm:p-9">
            <Eyebrow>Honest limits</Eyebrow>
            <h2 className="mt-3 text-[22px] font-[680] tracking-[-0.02em] text-fg">What this is not</h2>
            <ul className="mt-6 space-y-3">
              {limits.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[14px] leading-relaxed text-fg-muted">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent-hi" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href={site.github} variant="primary">
                <GitFork className="size-4" /> Source on GitHub
              </Button>
              <Button href="/signup" variant="secondary">
                Create an account <ArrowRight className="size-4" />
              </Button>
            </div>
          </Card>
        </Container>
      </section>
    </>
  );
}
