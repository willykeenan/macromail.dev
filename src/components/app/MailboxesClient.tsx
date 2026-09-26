"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Mail, Plus, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { DashboardHeader } from "@/components/app/DashboardHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createMailboxAction,
  markMailboxReadAction,
  sendInternalAction,
} from "@/lib/dashboard-actions";
import type { MailboxMessageRow, MailboxRow } from "@/lib/types/db";

const inputClass =
  "w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2 text-[13px] text-fg " +
  "placeholder:text-fg-faint outline-none focus:border-accent/50";

export function MailboxesClient({
  mailboxes,
  selectedAddress,
  messages,
  inboundNote,
  domains,
}: {
  mailboxes: MailboxRow[];
  selectedAddress: string | null;
  messages: MailboxMessageRow[];
  inboundNote: string;
  domains: string[];
}) {
  const exampleDomain = domains[0] ?? "example.com";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(mailboxes.length === 0);
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");

  const selected = useMemo(
    () => mailboxes.find((b) => b.address === selectedAddress) ?? mailboxes[0] ?? null,
    [mailboxes, selectedAddress],
  );

  function selectBox(addr: string) {
    router.push(`/app/mailboxes?box=${encodeURIComponent(addr)}`);
  }

  function create() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await createMailboxAction({ address, displayName });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setAddress("");
      setDisplayName("");
      setCreating(false);
      setNotice(res.note);
      router.push(`/app/mailboxes?box=${encodeURIComponent(res.address)}`);
      router.refresh();
    });
  }

  function sendInternal() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await sendInternalAction({
        from: selected.display_name ? `${selected.display_name} <${selected.address}>` : selected.address,
        to,
        subject,
        text,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setTo("");
      setSubject("");
      setText("");
      setNotice(`Delivered internally to ${res.internal_deliveries} mailbox${res.internal_deliveries === 1 ? "" : "es"}.`);
      router.refresh();
    });
  }

  function markRead(ids: string[]) {
    if (!selected || !ids.length) return;
    start(async () => {
      const res = await markMailboxReadAction(selected.address, ids);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  const unreadIds = messages.filter((m) => !m.read).map((m) => m.id);

  return (
    <>
      <DashboardHeader
        title="Mailboxes"
        description="Addresses MacroMail answers for. Mail sent through MacroMail to these addresses is delivered here. Internet inbound is not available."
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
            <Plus className="size-4" /> New mailbox
          </Button>
        }
      />

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

      {creating && (
        <Card className="mb-6 p-5">
          <h2 className="text-[15px] font-semibold text-fg">Create a mailbox</h2>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Mailboxes can use {domains.length === 1 ? "this server’s domain" : "these server domains"}:{" "}
            <code>{domains.join(", ")}</code>. For example <code>agent@{exampleDomain}</code>.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-[12px] text-fg-muted">
              Address
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={inputClass}
                placeholder={`agent@${exampleDomain}`}
                autoFocus
              />
            </label>
            <label className="space-y-1 text-[12px] text-fg-muted">
              Display name (optional)
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClass}
                placeholder="Support agent"
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button size="sm" onClick={create} disabled={pending || !address.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Create
            </Button>
            {mailboxes.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      )}

      {mailboxes.length === 0 && !creating ? (
        <EmptyState
          icon={Mail}
          title="No mailboxes yet"
          description="Create an address so agents can mail each other through this server. Public MX inbound is not available."
        >
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Create a mailbox
          </Button>
        </EmptyState>
      ) : mailboxes.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit overflow-hidden">
            <ul className="divide-y divide-border">
              {mailboxes.map((box) => {
                const active = selected?.address === box.address;
                return (
                  <li key={box.id}>
                    <button
                      type="button"
                      onClick={() => selectBox(box.address)}
                      className={`flex w-full flex-col items-start px-4 py-3 text-left ${active ? "bg-bg-overlay" : "hover:bg-bg-overlay/50"}`}
                    >
                      <span className="truncate text-[13.5px] font-medium text-fg">
                        {box.display_name || box.address}
                      </span>
                      {box.display_name && (
                        <span className="truncate text-[12px] text-fg-faint">{box.address}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected && (
            <div className="space-y-6">
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-fg">{selected.display_name || selected.address}</h2>
                    <p className="mt-1 font-mono text-[12.5px] text-fg-muted">{selected.address}</p>
                  </div>
                  <Badge tone="neutral">Internal only</Badge>
                </div>
                <p className="mt-3 text-[12.5px] leading-relaxed text-fg-faint">{inboundNote}</p>
              </Card>

              <Card className="p-5">
                <h3 className="text-[14px] font-semibold text-fg">Send to another MacroMail mailbox</h3>
                <p className="mt-1 text-[12.5px] text-fg-muted">
                  Delivery stays on this server. Use Send if the recipient is on the public internet.
                </p>
                <div className="mt-4 grid gap-3">
                  <label className="space-y-1 text-[12px] text-fg-muted">
                    To
                    <input
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                      className={inputClass}
                      placeholder={`other-agent@${exampleDomain}`}
                    />
                  </label>
                  <label className="space-y-1 text-[12px] text-fg-muted">
                    Subject
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className={inputClass}
                    />
                  </label>
                  <label className="space-y-1 text-[12px] text-fg-muted">
                    Body
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={5}
                      className={inputClass}
                    />
                  </label>
                  <div>
                    <Button
                      size="sm"
                      onClick={sendInternal}
                      disabled={pending || !to.trim() || !subject.trim() || !text.trim()}
                    >
                      {pending ? <Loader2 className="size-4 animate-spin" /> : null} Send internally
                    </Button>
                  </div>
                </div>
              </Card>

              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-5 py-3">
                  <h3 className="text-[14px] font-semibold text-fg">Messages</h3>
                  {unreadIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => markRead(unreadIds)}
                      className="text-[12px] text-accent-hi hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                {messages.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Inbox className="mx-auto size-5 text-fg-faint" />
                    <p className="mt-3 text-[14px] font-medium text-fg">This mailbox is empty</p>
                    <p className="mx-auto mt-1 max-w-[42ch] text-[12.5px] text-fg-muted">
                      Send from another MacroMail mailbox, REST /v1, or /api/mcp. Mail from the public internet will not arrive.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-border">
                    {messages.map((m) => (
                      <li key={m.id} className="px-5 py-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-[13.5px] font-medium text-fg">
                              {m.from_name ? `${m.from_name} <${m.from_addr}>` : m.from_addr}
                            </div>
                            <div className="mt-0.5 text-[13px] text-fg">{m.subject || "(no subject)"}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            {!m.read && <Badge tone="accent">Unread</Badge>}
                            <span className="text-[11.5px] text-fg-faint">
                              {new Date(m.created_at).toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-fg-muted">
                          {m.text || (m.html ? "(HTML body, no text part)" : "(empty)")}
                        </p>
                        {!m.read && (
                          <button
                            type="button"
                            onClick={() => markRead([m.id])}
                            className="mt-2 text-[12px] text-accent-hi hover:underline"
                          >
                            Mark read
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
