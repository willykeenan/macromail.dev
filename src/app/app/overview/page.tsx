import Link from "next/link";
import { Inbox, KeyRound, Mail, Plug, Send } from "lucide-react";
import { DashboardHeader } from "@/components/app/DashboardHeader";
import { OnboardingChecklist } from "@/components/app/OnboardingChecklist";
import { StatTile } from "@/components/app/StatTile";
import { EmailsTable } from "@/components/app/EmailsTable";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getOverviewStats, listEmails } from "@/lib/dashboard-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const stats = await getOverviewStats();
  const emails = await listEmails(8);

  return (
    <>
      <DashboardHeader
        title="Overview"
        description="MacroMail is a free, open-source, self-hosted email tool for AI agents. Counts below come from this server's SQLite store."
        actions={
          <Button href="/app/mailboxes" size="sm">
            <Mail className="size-3.5" /> Mailboxes
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={Mail}
          label="Mailboxes"
          value={stats.mailboxes}
          hint={stats.unread ? `${stats.unread} unread` : "Hosted agent addresses"}
        />
        <StatTile
          icon={Send}
          label="Sends (7 days)"
          value={stats.sent7d}
          hint={`${stats.sentTotal} total recorded`}
        />
        <StatTile
          icon={KeyRound}
          label="API keys"
          value={stats.keys}
          hint="REST v1 and /api/mcp"
        />
        <StatTile
          icon={Plug}
          label="Connected accounts"
          value={stats.accounts}
          hint={stats.accounts ? "Read-only Gmail or Outlook" : "OAuth optional"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
        <OnboardingChecklist hasMailbox={stats.mailboxes > 0} hasSmtp={stats.hasSmtp} hasKey={stats.keys > 0} />
        <Card className="p-5 sm:p-6">
          <h2 className="text-[15px] font-semibold text-fg">What this server does</h2>
          <ul className="mt-4 space-y-3 text-[13px] leading-relaxed text-fg-muted">
            <li>
              Agent mailboxes deliver mail to each other through MacroMail. Internet inbound is not available.
            </li>
            <li>
              Outbound internet email uses the SMTP account you store in{" "}
              <Link href="/app/settings" className="text-accent-hi hover:underline">
                Settings
              </Link>
              .
            </li>
            <li>
              Agents call REST <code className="text-[12px] text-fg">/api/v1</code> or MCP{" "}
              <code className="text-[12px] text-fg">/api/mcp</code> with an{" "}
              <Link href="/app/api-keys" className="text-accent-hi hover:underline">
                API key
              </Link>
              .
            </li>
            <li>
              Gmail and Outlook are optional and read-only when this server has OAuth credentials. AI triage and drafts use your Anthropic key.
            </li>
          </ul>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button href="/app/send" size="sm" variant="secondary">
              <Send className="size-3.5" /> Send
            </Button>
            <Button href="/app/inbox" size="sm" variant="ghost">
              <Inbox className="size-3.5" /> Inbox
            </Button>
          </div>
        </Card>
      </div>

      <div className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[15px] font-semibold text-fg">Recent sends</h2>
          <Link href="/app/send" className="text-[12.5px] text-accent-hi hover:underline">
            Compose
          </Link>
        </div>
        <EmailsTable items={emails} />
      </div>
    </>
  );
}
