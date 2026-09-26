import { Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { EmailListItem } from "@/lib/dashboard-actions";

function statusTone(status: string): "neutral" | "accent" | "success" | "warn" | "error" {
  if (status === "delivered" || status === "sent" || status === "internal") return "success";
  if (status === "failed" || status === "bounced" || status === "complained") return "error";
  if (status === "queued") return "warn";
  return "neutral";
}

export function EmailsTable({ items }: { items: EmailListItem[] }) {
  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          className="rounded-none border-0 bg-transparent py-16"
          icon={Mail}
          title="No emails recorded yet"
          description="Sends from this dashboard, REST /v1, and /api/mcp appear here. Create a mailbox and send internally, or add SMTP in Settings for internet outbound."
        >
          <Button href="/app/send" size="sm">
            Send an email
          </Button>
          <Button href="/app/mailboxes" variant="secondary" size="sm">
            Create a mailbox
          </Button>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[13.5px]">
          <thead>
            <tr className="border-b border-border text-[12px] uppercase tracking-wide text-fg-faint">
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">To</th>
              <th className="px-5 py-3 font-medium">Subject</th>
              <th className="px-5 py-3 font-medium">From</th>
              <th className="px-5 py-3 font-medium">Source</th>
              <th className="px-5 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((e) => (
              <tr key={e.id} className="align-top transition-colors hover:bg-bg-overlay/40">
                <td className="px-5 py-3.5">
                  <div className="flex flex-col gap-1">
                    <Badge tone={statusTone(e.status)} dot>
                      {e.status}
                    </Badge>
                    {e.simulated && <span className="text-[11px] text-fg-faint">simulated</span>}
                    {e.error && <span className="max-w-[22ch] text-[11px] text-error">{e.error}</span>}
                  </div>
                </td>
                <td className="px-5 py-3.5 text-fg-muted">{e.to_addrs?.join(", ")}</td>
                <td className="px-5 py-3.5 font-medium text-fg">{e.subject}</td>
                <td className="px-5 py-3.5 text-fg-muted">{e.from_addr}</td>
                <td className="px-5 py-3.5">
                  <Badge tone="mono">{e.source}</Badge>
                </td>
                <td className="px-5 py-3.5 tabular-nums text-fg-muted">
                  {new Date(e.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
