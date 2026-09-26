"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  changePasswordAction,
  saveAiKeyAction,
  saveSmtpAction,
  testSmtpAction,
  type ProfileSettings,
} from "@/lib/dashboard-actions";

const inputClass =
  "w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2 text-[13px] text-fg " +
  "placeholder:text-fg-faint outline-none focus:border-accent/50";

export function SettingsForms({ settings }: { settings: ProfileSettings }) {
  return (
    <div className="space-y-6">
      <AccountCard email={settings.email} />
      <SmtpCard settings={settings} />
      <AiKeyCard hasAiKey={settings.hasAiKey} />
    </div>
  );
}

function AccountCard({ email }: { email: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function save() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await changePasswordAction({ current, next });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setCurrent("");
      setNext("");
      setNotice("Password updated. Every other session was signed out.");
      router.refresh();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-fg">Account</h2>
      <p className="mt-1 text-[12.5px] text-fg-muted">
        Signed in as <span className="text-fg">{email || "unknown"}</span>.
      </p>
      {error && <Flash error={error} />}
      {notice && <Flash notice={notice} />}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[12px] text-fg-muted">
          Current password
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted">
          New password
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
        </label>
      </div>
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={pending || !current || next.length < 8}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Update password
        </Button>
      </div>
    </Card>
  );
}

function SmtpCard({ settings }: { settings: ProfileSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [host, setHost] = useState(settings.smtp_host ?? "");
  const [port, setPort] = useState(String(settings.smtp_port ?? 465));
  const [user, setUser] = useState(settings.smtp_user ?? "");
  const [pass, setPass] = useState("");
  const [fromDomain, setFromDomain] = useState(settings.smtp_from_domain ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function save() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await saveSmtpAction({ host, port, user, pass, from_domain: fromDomain });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setPass("");
      setNotice("SMTP account saved.");
      router.refresh();
    });
  }

  function test() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await testSmtpAction({ host, port, user, pass });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setNotice("SMTP login succeeded. No mail was sent.");
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-fg">Your SMTP account</h2>
      <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-fg-muted">
        Outbound internet email is sent only through credentials you store here. MacroMail never sends from the server owner&apos;s mailbox.
      </p>
      {error && <Flash error={error} />}
      {notice && <Flash notice={notice} />}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[12px] text-fg-muted">
          Host
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className={inputClass}
            placeholder="smtp.example.com"
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted">
          Port (465, 587, or 2525)
          <input value={port} onChange={(e) => setPort(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted">
          Username
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted">
          Password {settings.hasSmtpPass ? "(leave blank to keep; required if you change host, port, or username)" : ""}
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
          />
        </label>
        <label className="space-y-1 text-[12px] text-fg-muted sm:col-span-2">
          From domain (optional)
          <input
            value={fromDomain}
            onChange={(e) => setFromDomain(e.target.value)}
            className={inputClass}
            placeholder="example.com"
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={pending || !host.trim() || !user.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null} Save SMTP
        </Button>
        <Button size="sm" variant="secondary" onClick={test} disabled={pending || !host.trim() || !user.trim()}>
          Test connection
        </Button>
      </div>
    </Card>
  );
}

function AiKeyCard({ hasAiKey }: { hasAiKey: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function save() {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await saveAiKeyAction(key);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setKey("");
      setNotice("Anthropic key saved.");
      router.refresh();
    });
  }

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[15px] font-semibold text-fg">Your Anthropic key</h2>
      <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-fg-muted">
        Inbox triage, drafts, and MCP AI tools use the key stored on your account. MacroMail never uses a server-owner Anthropic key.
      </p>
      {error && <Flash error={error} />}
      {notice && <Flash notice={notice} />}
      <label className="mt-4 block space-y-1 text-[12px] text-fg-muted">
        API key {hasAiKey ? "(leave blank to keep the stored key)" : ""}
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className={inputClass}
          autoComplete="off"
          placeholder="sk-ant-…"
        />
      </label>
      <div className="mt-4">
        <Button size="sm" onClick={save} disabled={pending || !key.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {hasAiKey ? "Replace key" : "Save key"}
        </Button>
      </div>
    </Card>
  );
}

function Flash({ error, notice }: { error?: string | null; notice?: string | null }) {
  if (error) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
      </p>
    );
  }
  if (notice) {
    return (
      <p className="mt-3 flex items-start gap-1.5 rounded-[9px] border border-success/30 bg-success-bg px-3 py-2 text-[12.5px] text-success">
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> {notice}
      </p>
    );
  }
  return null;
}
