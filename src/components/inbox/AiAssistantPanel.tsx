"use client";

import { useState } from "react";
import {
  Sparkles, Copy, Check, Loader2, KeyRound, ChevronRight, X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

type Tab = "ask" | "compose" | "summarize" | "triage";
const TABS: { id: Tab; label: string }[] = [
  { id: "ask", label: "Ask" },
  { id: "compose", label: "Compose" },
  { id: "summarize", label: "Summarize" },
  { id: "triage", label: "Triage" },
];

const KEY_STORE = "mm_anthropic_key";

export function AiAssistantPanel({
  threadContext,
  className,
  onClose,
  serverAiEnabled = false,
}: {
  threadContext?: string | null;
  className?: string;
  onClose?: () => void;
  serverAiEnabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("compose");
  const [apiKey, setApiKey] = useState<string>(() =>
    typeof window !== "undefined" ? localStorage.getItem(KEY_STORE) || "" : "",
  );
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);

  function saveKey() {
    const k = keyInput.trim();
    if (!k) return;
    localStorage.setItem(KEY_STORE, k);
    setApiKey(k);
    setNeedsKey(false);
    setKeyInput("");
  }

  async function callAI<T>(path: string, body: unknown): Promise<T | null> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey ? { "x-anthropic-key": apiKey } : {}) },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 503) {
        if (!apiKey && !serverAiEnabled) setNeedsKey(true);
        setError(honestAiError(json?.error?.message || json?.error?.fix) || "AI requires an Anthropic API key. Add it in Settings.");
        return null;
      }
      if (!res.ok || json?.ok === false) {
        setError(honestAiError(json?.error?.message || json?.message) || "Something went wrong.");
        return null;
      }
      return json as T;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn("flex h-full w-full flex-col bg-bg-raised/40", className)}>
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent-hi" />
          <span className="text-[14px] font-semibold text-fg">AI Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          {apiKey || serverAiEnabled ? (
            <Badge tone="success" dot>Claude</Badge>
          ) : (
            <Badge tone="warn" dot>key required</Badge>
          )}
          {onClose && (
            <button onClick={onClose} className="rounded-md p-1 text-fg-faint hover:bg-bg-overlay hover:text-fg">
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-0.5 border-b border-border px-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setError(null); }}
            className={cn(
              "relative px-3 py-2.5 text-[12.5px] font-medium transition-colors",
              tab === t.id ? "text-fg" : "text-fg-faint hover:text-fg-muted",
            )}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {needsKey && !apiKey && !serverAiEnabled ? (
          <KeyPrompt keyInput={keyInput} setKeyInput={setKeyInput} onSave={saveKey} error={error} />
        ) : (
          <>
            {tab === "ask" && <AskTab callAI={callAI} loading={loading} threadContext={threadContext} />}
            {tab === "compose" && <ComposeTab callAI={callAI} loading={loading} threadContext={threadContext} />}
            {tab === "summarize" && <SummarizeTab key={threadContext ?? "none"} callAI={callAI} loading={loading} threadContext={threadContext} />}
            {tab === "triage" && <TriageTab callAI={callAI} loading={loading} />}
            {error && (
              <p className="mt-3 rounded-[8px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">{error}</p>
            )}
          </>
        )}
      </div>

      {/* footer */}
      <div className="border-t border-border px-4 py-2.5">
        <p className="text-[11px] leading-snug text-fg-faint">
          Powered by Claude. Your text is sent to Anthropic to generate a response. Nothing is stored.
        </p>
      </div>
    </div>
  );
}

function honestAiError(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

function KeyPrompt({
  keyInput, setKeyInput, onSave, error,
}: { keyInput: string; setKeyInput: (v: string) => void; onSave: () => void; error: string | null }) {
  return (
    <div className="rounded-[12px] border border-warn/30 bg-warn-bg/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-warn">
        <KeyRound className="size-4" />
        <span className="text-[13px] font-semibold">Connect your AI</span>
      </div>
      <p className="text-[12.5px] text-fg-muted">
        Inbox triage and drafts use the Anthropic key stored in Settings. You can also paste a key here for this browser session.
      </p>
      <input
        value={keyInput}
        onChange={(e) => setKeyInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSave()}
        type="password"
        placeholder="sk-ant-…"
        className="mt-3 w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2.5 font-mono text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
      />
      <button
        onClick={onSave}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/10 [background:var(--gradient-btn)] px-4 py-2.5 text-[13px] font-medium text-white"
      >
        Save key & enable AI
      </button>
      {error && <p className="mt-2 text-[12px] text-error">{error}</p>}
    </div>
  );
}

/* ── Shared bits ── */
function RunButton({ loading, label, onClick }: { loading: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-white/10 [background:var(--gradient-btn)] px-4 py-2.5 text-[13px] font-medium text-white transition-all hover:brightness-110 disabled:opacity-60"
    >
      {loading ? <Loader2 className="size-4 animate-[spin_1s_linear_infinite]" /> : <Sparkles className="size-4" />}
      {label}
    </button>
  );
}

function CopyBtn({ value }: { value: string }) {
  const [c, setC] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(value); setC(true); setTimeout(() => setC(false), 1500); }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-overlay px-2 py-1 text-[11.5px] text-fg-muted hover:text-fg"
    >
      {c ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}{c ? "Copied" : "Copy"}
    </button>
  );
}

const ta = "w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/25 resize-none";

/* ── Ask ── */
function AskTab({ callAI, loading, threadContext }: { callAI: <T>(p: string, b: unknown) => Promise<T | null>; loading: boolean; threadContext?: string | null }) {
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  async function run() {
    if (!q.trim()) return;
    setAnswer(null);
    const r = await callAI<{ answer: string }>("/api/ai/ask", { question: q, context: threadContext || undefined });
    if (r) setAnswer(r.answer);
  }
  return (
    <div className="space-y-3">
      <textarea rows={4} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything, or paste an email to understand or reply to it…" className={ta} />
      <RunButton loading={loading} label="Ask Claude" onClick={run} />
      {answer && (
        <div className="rounded-[10px] border border-border bg-bg-inset p-3 text-[13px] leading-relaxed text-fg-muted whitespace-pre-wrap">
          {answer}
          <div className="mt-2"><CopyBtn value={answer} /></div>
        </div>
      )}
    </div>
  );
}

/* ── Compose ── */
function ComposeTab({ callAI, loading, threadContext }: { callAI: <T>(p: string, b: unknown) => Promise<T | null>; loading: boolean; threadContext?: string | null }) {
  const [intent, setIntent] = useState("");
  const [tone, setTone] = useState("friendly");
  const [out, setOut] = useState<{ subject: string; body: string } | null>(null);
  async function run() {
    if (!intent.trim()) return;
    setOut(null);
    const r = await callAI<{ subject: string; body: string }>("/api/ai/compose", {
      mode: threadContext ? "reply" : "new",
      intent,
      tone,
      thread: threadContext ? { text: threadContext } : undefined,
    });
    if (r) setOut({ subject: r.subject, body: r.body });
  }
  return (
    <div className="space-y-3">
      <input value={intent} onChange={(e) => setIntent(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Decline the meeting politely, suggest Thursday…" className={ta.replace("resize-none", "")} />
      <div className="flex items-center gap-2">
        <select value={tone} onChange={(e) => setTone(e.target.value)} className="rounded-[9px] border border-border bg-bg-inset px-2.5 py-2 text-[12.5px] text-fg-muted outline-none">
          {["friendly", "professional", "concise", "warm", "firm"].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <RunButton loading={loading} label={threadContext ? "Draft reply" : "Compose"} onClick={run} />
      </div>
      {out && (
        <div className="space-y-2 rounded-[10px] border border-border bg-bg-inset p-3">
          <div className="text-[11px] uppercase tracking-wide text-fg-faint">Subject</div>
          <div className="text-[13px] font-medium text-fg">{out.subject}</div>
          <div className="mt-1 border-t border-border pt-2 text-[13px] leading-relaxed text-fg-muted whitespace-pre-wrap">{out.body}</div>
          <CopyBtn value={`Subject: ${out.subject}\n\n${out.body}`} />
        </div>
      )}
    </div>
  );
}

/* ── Summarize ── */
function SummarizeTab({ callAI, loading, threadContext }: { callAI: <T>(p: string, b: unknown) => Promise<T | null>; loading: boolean; threadContext?: string | null }) {
  const [text, setText] = useState(() => threadContext || "");
  const [out, setOut] = useState<{ tldr: string[]; actionItems: { text: string; due?: string }[] } | null>(null);
  async function run() {
    if (!text.trim()) return;
    setOut(null);
    const r = await callAI<{ tldr: string[]; actionItems: { text: string; due?: string }[] }>("/api/ai/summarize", { thread: { text } });
    if (r) setOut(r);
  }
  return (
    <div className="space-y-3">
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste an email thread to summarize…" className={ta} />
      <RunButton loading={loading} label="Summarize" onClick={run} />
      {out && (
        <div className="space-y-3 rounded-[10px] border border-accent/25 bg-accent-bg/40 p-3">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent-hi"><Sparkles className="size-3" /> TL;DR</div>
            <ul className="space-y-1">{out.tldr.map((p, i) => <li key={i} className="flex gap-2 text-[13px] text-fg"><ChevronRight className="mt-0.5 size-3.5 shrink-0 text-accent-hi" />{p}</li>)}</ul>
          </div>
          {out.actionItems?.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Action items</div>
              <ul className="space-y-1">{out.actionItems.map((a, i) => <li key={i} className="text-[12.5px] text-fg-muted">☐ {a.text}{a.due ? ` — ${a.due}` : ""}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Triage ── */
function TriageTab({ callAI, loading }: { callAI: <T>(p: string, b: unknown) => Promise<T | null>; loading: boolean }) {
  const [text, setText] = useState("");
  const [out, setOut] = useState<{ id: string; label: string; reason: string }[] | null>(null);
  async function run() {
    const items = text.split("\n").map((l) => l.trim()).filter(Boolean).map((subject, i) => ({ id: `row_${i}`, subject }));
    if (!items.length) return;
    setOut(null);
    const r = await callAI<{ results: { id: string; label: string; reason: string }[] }>("/api/ai/triage", { items });
    if (r) setOut(r.results);
  }
  const tone: Record<string, "accent" | "warn" | "neutral" | "mono"> = { important: "accent", action_needed: "warn", newsletter: "neutral", promotions: "neutral", fyi: "mono" };
  return (
    <div className="space-y-3">
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste email subjects, one per line:\nInvoice #44 overdue\nYour weekly newsletter\nCan we meet Thursday?"} className={ta} />
      <RunButton loading={loading} label="Triage" onClick={run} />
      {out && (
        <div className="divide-y divide-border rounded-[10px] border border-border bg-bg-inset">
          {out.map((r, i) => (
            <div key={i} className="flex items-start justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-fg">{text.split("\n").filter(Boolean)[i]}</div>
                <div className="text-[11.5px] text-fg-faint">{r.reason}</div>
              </div>
              <Badge tone={tone[r.label] ?? "neutral"}>{r.label.replace("_", " ")}</Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
