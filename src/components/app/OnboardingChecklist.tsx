import Link from "next/link";
import { Check, ArrowRight, KeyRound, Mail, Send } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    key: "mailbox",
    label: "Create an agent mailbox",
    href: "/app/mailboxes",
    icon: Mail,
    hint: "Addresses you register here receive mail sent through MacroMail. Internet inbound is not available.",
  },
  {
    key: "smtp",
    label: "Add your SMTP account",
    href: "/app/settings",
    icon: Send,
    hint: "Outbound internet mail goes through credentials you store. MacroMail does not send from the server owner's mailbox.",
  },
  {
    key: "key",
    label: "Create an API key",
    href: "/app/api-keys",
    icon: KeyRound,
    hint: "Shown once. Use it with REST /v1 or the MCP endpoint at /api/mcp.",
  },
] as const;

export function OnboardingChecklist({
  hasMailbox,
  hasSmtp,
  hasKey,
}: {
  hasMailbox: boolean;
  hasSmtp: boolean;
  hasKey: boolean;
}) {
  const done = { mailbox: hasMailbox, smtp: hasSmtp, key: hasKey };
  const count = STEPS.filter((s) => done[s.key]).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">Get set up</h2>
          <p className="text-[12.5px] text-fg-muted">Three steps to a working agent mailbox.</p>
        </div>
        <span className="rounded-full border border-border bg-bg-overlay px-2.5 py-1 text-[12px] font-medium tabular-nums text-fg-muted">
          {count} of {STEPS.length} done
        </span>
      </div>
      <ul className="divide-y divide-border">
        {STEPS.map((s) => {
          const complete = done[s.key];
          return (
            <li key={s.key}>
              <Link
                href={s.href}
                className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-overlay/50"
              >
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-[10px] border",
                    complete
                      ? "border-success/30 bg-success-bg text-success"
                      : "border-border bg-bg-overlay text-accent-hi",
                  )}
                >
                  {complete ? <Check className="size-4" /> : <s.icon className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn("text-[14px] font-medium", complete ? "text-fg-muted line-through" : "text-fg")}>
                    {s.label}
                  </div>
                  <div className="text-[12.5px] text-fg-faint">{s.hint}</div>
                </div>
                {!complete && (
                  <ArrowRight className="size-4 text-fg-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg-muted" />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
