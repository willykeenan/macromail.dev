"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Inbox, Layers, Plus, Sparkles, Search, Plug, RefreshCw, Loader2, Mail,
  CircleAlert, ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { AiAssistantPanel } from "@/components/inbox/AiAssistantPanel";
import { LABEL_META } from "@/lib/inbox/types";
import type { AiLabel, MailThread } from "@/lib/inbox/types";
import type { InboxProvider } from "@/lib/types/db";
import { cn } from "@/lib/utils";

export interface InboxAccount {
  id: string;
  provider: InboxProvider;
  email: string;
  color: string;
  status: "connected" | "needs_auth" | "error";
}

const LABEL_TONE: Record<AiLabel, "accent" | "warn" | "neutral" | "mono"> = {
  important: "accent",
  action_needed: "warn",
  newsletter: "neutral",
  promotions: "neutral",
  fyi: "mono",
};

const KEY_STORE = "mm_anthropic_key";

export function InboxWorkspace({
  accounts,
  serverAiEnabled,
  oauthReady = false,
}: {
  accounts: InboxAccount[];
  signedIn: boolean;
  serverAiEnabled: boolean;
  oauthReady?: boolean;
}) {
  const [scope, setScope] = useState<string>("all");
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<MailThread | null>(null);
  // Lazy init keeps these out of an effect (SSR renders the defaults, then hydrates).
  const [aiOpen, setAiOpen] = useState(
    () => !(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("ai") === "0"),
  );
  const [query, setQuery] = useState("");
  const [byokKey] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(KEY_STORE) || "" : "",
  );
  const [triaging, setTriaging] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasAccounts = accounts.length > 0;
  const aiEnabled = serverAiEnabled || Boolean(byokKey);

  const aiHeaders = useCallback(
    (): Record<string, string> => (byokKey ? { "x-anthropic-key": byokKey } : {}),
    [byokKey],
  );

  const fetchThreads = useCallback(
    async (q?: string) => {
      if (!hasAccounts) return;
      setLoading(true);
      setLoadError(null);
      try {
        const sp = new URLSearchParams();
        if (scope !== "all") sp.set("accountId", scope);
        if (q?.trim()) sp.set("query", q.trim());
        const res = await fetch(`/api/inbox/threads?${sp.toString()}`);
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          setLoadError(json?.error?.message || "Couldn’t load your mail.");
          setThreads([]);
          return;
        }
        setThreads(json.threads as MailThread[]);
      } catch (e) {
        setLoadError((e as Error).message);
        setThreads([]);
      } finally {
        setLoading(false);
      }
    },
    [hasAccounts, scope],
  );

  // Refetch whenever the account scope changes; selection is cleared by the
  // scope-change handler. fetchThreads is async (its setState runs after an
  // await), so this is a data-fetch effect, not a synchronous render cascade.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchThreads();
  }, [fetchThreads]);

  function changeScope(next: string) {
    setSelectedId(null);
    setSelected(null);
    setScope(next);
  }

  // Debounced search.
  function onSearchChange(v: string) {
    setQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchThreads(v), 400);
  }

  const openThread = useCallback(
    async (composite: string) => {
      setSelectedId(composite);
      setSelected(null);
      try {
        const res = await fetch(`/api/inbox/thread/${encodeURIComponent(composite)}`);
        const json = await res.json();
        if (res.ok && json.ok !== false) setSelected(json.thread as MailThread);
      } catch {
        // keep the list-level snippet view; error surfaced below
      }
    },
    [],
  );

  async function triageAll() {
    if (!aiEnabled || threads.length === 0) return;
    setTriaging(true);
    try {
      const res = await fetch("/api/inbox/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiHeaders() },
        body: JSON.stringify({ threadIds: threads.slice(0, 25).map((t) => t.id) }),
      });
      const json = await res.json();
      if (res.ok && json.ok !== false && json.results) {
        const results = json.results as Record<string, { labels: AiLabel[]; summary: string }>;
        setThreads((prev) => prev.map((t) => (results[t.id] ? { ...t, labels: results[t.id].labels } : t)));
      }
    } finally {
      setTriaging(false);
    }
  }

  const selectedThread = useMemo(
    () => selected ?? threads.find((t) => t.id === selectedId) ?? null,
    [selected, threads, selectedId],
  );

  const threadContext = useMemo(() => {
    if (!selectedThread) return null;
    const head = `Subject: ${selectedThread.subject}`;
    const body = selectedThread.messages
      .map((m) => `From: ${m.from.name || m.from.email} (${fmtDate(m.date)})\n${m.bodyText}`)
      .join("\n\n---\n\n");
    return `${head}\n\n${body}`;
  }, [selectedThread]);

  return (
    <div className="fixed inset-0 top-[57px] z-20 flex bg-bg-base md:left-[240px]">
      {/* Pane 1 — account rail */}
      <aside className="hidden w-[230px] shrink-0 flex-col border-r border-border lg:flex">
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <button
            onClick={() => changeScope("all")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] transition-colors",
              scope === "all"
                ? "bg-bg-overlay text-fg [box-shadow:var(--shadow-inner-hi)]"
                : "text-fg-muted hover:bg-bg-overlay/60 hover:text-fg",
            )}
          >
            <span className="grid size-6 place-items-center rounded-md [background:var(--gradient-btn)]">
              <Layers className="size-3.5 text-white" />
            </span>
            All accounts
            <Badge tone="neutral" className="ml-auto">{accounts.length}</Badge>
          </button>

          {hasAccounts && (
            <ul className="mt-1 space-y-0.5">
              {accounts.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => changeScope(a.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13px] transition-colors",
                      scope === a.id ? "bg-bg-overlay text-fg" : "text-fg-muted hover:bg-bg-overlay/60 hover:text-fg",
                    )}
                  >
                    <span className="size-2 rounded-full" style={{ background: a.color }} />
                    <span className="truncate">{a.email}</span>
                    {a.status === "needs_auth" && <CircleAlert className="ml-auto size-3.5 shrink-0 text-warn" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-border p-3">
          <Link
            href="/app/accounts"
            className="flex items-center gap-2 rounded-[10px] border border-accent/25 bg-accent-bg px-3 py-2 text-[13px] font-medium text-accent-hi hover:border-accent/40"
          >
            <Plus className="size-4" /> Connect account
          </Link>
        </div>
      </aside>

      {/* Pane 2 — thread list */}
      <div className="flex w-full min-w-0 flex-col md:max-w-[400px] md:border-r md:border-border lg:max-w-[420px]">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint" />
            <input
              value={query}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search your mail…"
              className="w-full rounded-[9px] border border-border bg-bg-inset py-2 pl-8 pr-3 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
            />
          </div>
          <button
            onClick={() => void fetchThreads(query)}
            className="rounded-[9px] border border-border bg-bg-raised p-2 text-fg-muted hover:text-fg"
            title="Refresh"
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </button>
        </div>

        {/* triage bar */}
        {hasAccounts && threads.length > 0 && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
            <span className="text-[12px] text-fg-faint">{threads.length} threads</span>
            <button
              onClick={triageAll}
              disabled={!aiEnabled || triaging}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-accent/25 bg-accent-bg px-2.5 py-1 text-[12px] font-medium text-accent-hi hover:border-accent/40 disabled:opacity-50"
              title={aiEnabled ? "Label every thread with Claude" : "Add an Anthropic key in the AI panel to enable"}
            >
              {triaging ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
              Triage all
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasAccounts ? (
            <div className="flex h-full items-center justify-center p-6">
              {oauthReady ? (
                <ZeroState
                  icon={Inbox}
                  title="Connect an email account"
                  body="This inbox reads Gmail or Outlook when those accounts are connected. Agent mailboxes are under Mailboxes. Internet inbound to those addresses is not available."
                >
                  <Button href="/app/accounts"><Plug className="size-4" /> Connect an account</Button>
                </ZeroState>
              ) : (
                <ZeroState
                  icon={Inbox}
                  title="No connected inbox"
                  body="This inbox reads Gmail or Outlook. This server has no OAuth credentials, so Connect is unavailable. Use Mailboxes for agent addresses on this server."
                >
                  <Button href="/app/mailboxes"><Mail className="size-4" /> Open mailboxes</Button>
                  <Button href="/app/accounts" variant="secondary"><Plug className="size-4" /> Why connect is off</Button>
                </ZeroState>
              )}
            </div>
          ) : loading && threads.length === 0 ? (
            <div className="flex h-full items-center justify-center text-fg-faint">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : loadError ? (
            <div className="flex h-full items-center justify-center p-6">
              <ZeroState icon={CircleAlert} title="Couldn’t load your mail" body={loadError}>
                <Button variant="secondary" onClick={() => void fetchThreads(query)}>
                  <RefreshCw className="size-4" /> Try again
                </Button>
              </ZeroState>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <ZeroState icon={Inbox} title="No messages" body={query ? "No threads match your search." : "This inbox is empty right now."} />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {threads.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  account={accounts.find((a) => a.id === t.accountId)}
                  active={t.id === selectedId}
                  onClick={() => void openThread(t.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Pane 3 — reading pane */}
      <div className={cn("min-w-0 flex-1 flex-col bg-bg-base", selectedId ? "flex" : "hidden md:flex")}>
        {selectedThread ? (
          <ReadingPane
            key={selectedThread.id}
            thread={selectedThread}
            loading={Boolean(selectedId) && !selected && !threads.find((t) => t.id === selectedId)?.messages.length}
            account={accounts.find((a) => a.id === selectedThread.accountId)}
            aiEnabled={aiEnabled}
            aiHeaders={aiHeaders}
            onBack={() => { setSelectedId(null); setSelected(null); }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <ZeroState icon={Mail} title="Select a thread" body="Pick a conversation on the left to read it. Connected accounts are read-only." />
          </div>
        )}
      </div>

      {/* Docked AI panel */}
      {aiOpen ? (
        <div className="hidden w-[360px] shrink-0 border-l border-border xl:block">
          <AiAssistantPanel
            threadContext={threadContext}
            serverAiEnabled={serverAiEnabled}
            onClose={() => setAiOpen(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setAiOpen(true)}
          className="hidden w-12 shrink-0 flex-col items-center gap-2 border-l border-border py-4 text-fg-faint hover:text-accent-hi xl:flex"
          title="Open AI assistant"
        >
          <Sparkles className="size-5 text-accent-hi" />
          <span className="[writing-mode:vertical-rl] text-[11px] tracking-wide">AI Assistant</span>
        </button>
      )}
    </div>
  );
}

function ThreadRow({
  thread,
  account,
  active,
  onClick,
}: {
  thread: MailThread;
  account?: InboxAccount;
  active: boolean;
  onClick: () => void;
}) {
  const last = thread.messages[thread.messages.length - 1];
  const who = thread.participants[0]?.name || thread.participants[0]?.email || last?.from.email || "Unknown";
  return (
    <li>
      <button
        onClick={onClick}
        className={cn(
          "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors",
          active ? "bg-bg-overlay" : "hover:bg-bg-overlay/50",
        )}
      >
        <div className="flex items-center gap-2">
          {account && <span className="size-2 shrink-0 rounded-full" style={{ background: account.color }} />}
          <span className={cn("truncate text-[13px]", thread.unread ? "font-semibold text-fg" : "text-fg-muted")}>
            {who}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-fg-faint">{last ? fmtDate(last.date) : ""}</span>
        </div>
        <div className={cn("truncate text-[13px]", thread.unread ? "font-medium text-fg" : "text-fg-muted")}>
          {thread.subject || "(no subject)"}
        </div>
        <div className="truncate text-[12px] text-fg-faint">{thread.snippet}</div>
        {thread.labels.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {thread.labels.map((l) => (
              <Badge key={l} tone={LABEL_TONE[l]} className="!px-1.5 !py-0 text-[10.5px]">
                {LABEL_META[l].name}
              </Badge>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}

function ReadingPane({
  thread,
  loading,
  account,
  aiEnabled,
  aiHeaders,
  onBack,
}: {
  thread: MailThread;
  loading: boolean;
  account?: InboxAccount;
  aiEnabled: boolean;
  aiHeaders: () => Record<string, string>;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function generateDraft() {
    setDrafting(true);
    setActionError(null);
    try {
      const res = await fetch("/api/inbox/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...aiHeaders() },
        body: JSON.stringify({ threadId: thread.id }),
      });
      const json = await res.json();
      if (res.status === 503) {
        setActionError(String(json?.error?.fix || json?.error?.message || "AI is not configured."));
        return;
      }
      if (!res.ok || json.ok === false) {
        setActionError(String(json?.error?.message || "Couldn’t draft a reply."));
        return;
      }
      setDraft(json.draft as string);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <button onClick={onBack} className="mt-0.5 rounded-md p-1 text-fg-faint hover:bg-bg-overlay hover:text-fg md:hidden" title="Back">
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold text-fg">{thread.subject || "(no subject)"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-fg-faint">
            {account && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: account.color }} /> {account.email}
              </span>
            )}
            <span>· {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}</span>
            {thread.labels.map((l) => (
              <Badge key={l} tone={LABEL_TONE[l]} className="!px-1.5 !py-0 text-[10.5px]">{LABEL_META[l].name}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-10 text-fg-faint"><Loader2 className="size-5 animate-spin" /></div>
        ) : (
          <div className="space-y-4">
            {thread.messages.map((m) => (
              <div key={m.id} className="rounded-[12px] border border-border bg-bg-raised p-4">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg">{m.from.name || m.from.email}</span>
                  <span className="text-[11.5px] text-fg-faint">{fmtDate(m.date, true)}</span>
                </div>
                <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg-muted">
                  {m.bodyText || "(no text content)"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* reply composer */}
      <div className="shrink-0 border-t border-border p-4">
        {actionError && (
          <p className="mb-2 rounded-[8px] border border-error/30 bg-error-bg px-3 py-2 text-[12px] text-error">{actionError}</p>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Write a draft. Connected Gmail and Outlook accounts are read-only — nothing is sent from them."
          className="w-full resize-none rounded-[10px] border border-border bg-bg-inset px-3 py-2.5 text-[13.5px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={generateDraft}
            disabled={drafting || !aiEnabled}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-accent/25 bg-accent-bg px-3 py-1.5 text-[12.5px] font-medium text-accent-hi hover:border-accent/40 disabled:opacity-50"
            title={aiEnabled ? "Draft a reply with Claude" : "Add your Anthropic key in Settings to enable drafts"}
          >
            {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Draft with Claude
          </button>
          <p className="text-[12px] text-fg-faint">
            Read-only. Send internet mail from{" "}
            <Link href="/app/send" className="text-accent-hi hover:underline">Send</Link> with your SMTP account.
          </p>
        </div>
      </div>
    </div>
  );
}

function ZeroState({
  icon: Icon, title, body, children,
}: { icon: typeof Inbox; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="flex max-w-sm flex-col items-center text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-[12px] border border-border bg-bg-overlay text-accent-hi [box-shadow:var(--shadow-inner-hi)]">
        <Icon className="size-5" />
      </div>
      <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">{body}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  );
}

function fmtDate(iso: string, full = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (full) return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 24 * 3600_000 && d.getDate() === new Date().getDate()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
