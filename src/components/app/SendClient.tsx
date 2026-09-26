"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { DashboardHeader } from "@/components/app/DashboardHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { sendEmailAction } from "@/lib/dashboard-actions";
import type { MailboxRow } from "@/lib/types/db";

const inputClass =
  "w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2 text-[13px] text-fg " +
  "placeholder:text-fg-faint outline-none focus:border-accent/50";

export function SendClient({
  hasSmtp,
  defaultFrom,
  mailboxes,
}: {
  hasSmtp: boolean;
  defaultFrom: string;
  mailboxes: MailboxRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function send() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await sendEmailAction({ from, to, subject, text });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setTo("");
      setSubject("");
      setText("");
      const bits = [`Status: ${res.status}`];
      if (res.internal_deliveries) bits.push(`${res.internal_deliveries} internal delivery`);
      setNotice(bits.join(" · "));
      router.refresh();
    });
  }

  return (
    <>
      <DashboardHeader
        title="Send"
        description="Internet outbound uses the SMTP account you stored in Settings. Recipients that are MacroMail mailboxes are delivered on this server even without SMTP."
      />

      {!hasSmtp && (
        <p className="mb-4 flex items-start gap-1.5 rounded-[9px] border border-warn/30 bg-warn-bg px-3 py-2 text-[12.5px] text-warn">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          No SMTP account is configured. Mail to addresses that are not MacroMail mailboxes will fail. Add your SMTP credentials in Settings. MacroMail never sends from the server owner&apos;s mailbox.
        </p>
      )}
      {error && (
        <p className="mb-4 flex items-start gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 flex items-start gap-1.5 rounded-[9px] border border-success/30 bg-success-bg px-3 py-2 text-[12.5px] text-success">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> {notice}
        </p>
      )}

      <Card className="p-5 sm:p-6">
        <div className="grid gap-3">
          <label className="space-y-1 text-[12px] text-fg-muted">
            From
            <input value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
            {mailboxes.length > 0 && (
              <span className="block text-[11.5px] text-fg-faint">
                Mailboxes: {mailboxes.map((b) => b.address).join(", ")}
              </span>
            )}
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            To
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={inputClass}
              placeholder="agent@example.com, you@company.com"
            />
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            Subject
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-[12px] text-fg-muted">
            Body
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className={inputClass} />
          </label>
          <div>
            <Button
              size="sm"
              onClick={send}
              disabled={pending || !from.trim() || !to.trim() || !subject.trim() || !text.trim()}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-3.5" />}
              Send
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}
