"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plug, Mail, Building2, Trash2, ShieldCheck, RefreshCw, AlertCircle, CheckCircle2, Lock, ExternalLink, Loader2,
} from "lucide-react";
import { DashboardHeader } from "@/components/app/DashboardHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { PROVIDER_META } from "@/lib/inbox/types";
import type { InboxProvider } from "@/lib/types/db";

export interface AccountView {
  id: string;
  provider: InboxProvider;
  email: string;
  status: "connected" | "needs_auth" | "error";
  color: string;
  createdAt: string;
  lastSync: string | null;
}

const PROVIDER_ICON: Record<InboxProvider, typeof Mail> = { gmail: Mail, outlook: Building2, imap: Mail };

const statusBadge: Record<AccountView["status"], { tone: "success" | "warn" | "error"; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  needs_auth: { tone: "warn", label: "Reauthorize" },
  error: { tone: "error", label: "Error" },
};

export function AccountsClient({
  accounts,
  signedIn,
  googleReady,
  microsoftReady,
}: {
  accounts: AccountView[];
  signedIn: boolean;
  googleReady: boolean;
  microsoftReady: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const justConnected = params.get("connected") === "1";
  const errorParam = params.get("error");
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  function disconnect(accountId: string) {
    if (!window.confirm("Disconnect this mailbox? It will no longer appear in Inbox.")) return;
    setBusyId(accountId);
    start(async () => {
      await fetch("/api/inbox/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      setBusyId(null);
      router.refresh();
    });
  }

  return (
    <>
      <DashboardHeader
        title="Connected accounts"
        description="Optional read-only Gmail or Outlook. MacroMail stores encrypted OAuth tokens, never the mailbox password. Agent mailboxes live under Mailboxes and do not use OAuth."
      />

      {justConnected && (
        <p className="mb-4 flex items-center gap-2 rounded-[9px] border border-success/30 bg-success-bg px-3 py-2 text-[12.5px] text-success">
          <CheckCircle2 className="size-4 shrink-0" /> Account connected. Threads from this mailbox can be read in Inbox.
        </p>
      )}
      {errorParam && (
        <p className="mb-4 flex items-start gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {errorMessage(errorParam)}
        </p>
      )}

      {accounts.length > 0 && (
        <div className="mb-6 space-y-3">
          {accounts.map((a) => {
            const Icon = PROVIDER_ICON[a.provider];
            const sb = statusBadge[a.status];
            return (
              <Card key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="size-2.5 rounded-full" style={{ background: a.color }} />
                  <span className="grid size-9 place-items-center rounded-[10px] border border-border bg-bg-overlay text-accent-hi">
                    <Icon className="size-4" />
                  </span>
                  <div>
                    <div className="text-[14px] font-medium text-fg">{a.email}</div>
                    <div className="text-[12px] text-fg-faint">
                      {PROVIDER_META[a.provider].name}
                      {a.createdAt ? ` · added ${a.createdAt}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={sb.tone} dot>{sb.label}</Badge>
                  {a.status === "needs_auth" && (
                    <Button size="sm" variant="secondary" href={`/api/inbox/connect/${a.provider === "gmail" ? "google" : "outlook"}`}>
                      <RefreshCw className="size-3.5" /> Reauthorize
                    </Button>
                  )}
                  <button
                    onClick={() => disconnect(a.id)}
                    disabled={pending && busyId === a.id}
                    className="rounded-md p-2 text-fg-faint hover:bg-error-bg hover:text-error disabled:opacity-50"
                    title="Disconnect"
                  >
                    {pending && busyId === a.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No accounts connected yet"
          description="Connect Gmail or Outlook to read that mailbox here. This is optional. For agent addresses on this server, create a mailbox instead."
          className="!py-10"
        >
          <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
            <ConnectCard provider="gmail" ready={googleReady} signedIn={signedIn} />
            <ConnectCard provider="outlook" ready={microsoftReady} signedIn={signedIn} />
          </div>
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <ConnectCard provider="gmail" ready={googleReady} signedIn={signedIn} compact />
          <ConnectCard provider="outlook" ready={microsoftReady} signedIn={signedIn} compact />
        </div>
      )}
    </>
  );
}

function ConnectCard({
  provider,
  ready,
  signedIn,
  compact,
}: {
  provider: "gmail" | "outlook";
  ready: boolean;
  signedIn: boolean;
  compact?: boolean;
}) {
  const meta = PROVIDER_META[provider];
  const Icon = provider === "gmail" ? Mail : Building2;
  const ui = provider === "gmail" ? "google" : "outlook";
  return (
    <Card className="p-4 text-left">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border bg-bg-overlay text-accent-hi">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-fg">
            {meta.name} <Badge tone="neutral">{meta.badge}</Badge>
          </div>
          {!compact && <div className="mt-0.5 text-[12.5px] text-fg-muted">{meta.desc}</div>}

          <div className="mt-3">
            {!ready ? (
              <div className="flex items-start gap-2 rounded-[9px] border border-warn/30 bg-warn-bg px-3 py-2 text-[12px] text-warn">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  This server does not have OAuth credentials for {meta.name}.
                </span>
              </div>
            ) : !signedIn ? (
              <div className="flex items-start gap-2 rounded-[9px] border border-border bg-bg-inset px-3 py-2 text-[12px] text-fg-muted">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> Sign in to connect your {meta.name} account.
              </div>
            ) : (
              <Button size="sm" variant="secondary" href={`/api/inbox/connect/${ui}`} className="w-full sm:w-auto">
                <ExternalLink className="size-3.5" /> Connect {meta.name}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function errorMessage(code: string): string {
  if (code === "google_not_configured") return "Gmail connections are not available on this deployment yet.";
  if (code === "microsoft_not_configured") return "Outlook connections are not available on this deployment yet.";
  if (code === "state_mismatch" || code === "bad_state") return "The sign-in attempt expired or didn’t match your session. Please try connecting again.";
  if (code === "missing_code") return "The provider didn’t return an authorization code. Please try again.";
  if (code === "access_denied") return "You declined the permission request. Connect again and approve access to continue.";
  if (code === "provider_callback_failed") return "The provider connection could not be completed. Please try again.";
  return "The provider connection could not be completed.";
}
