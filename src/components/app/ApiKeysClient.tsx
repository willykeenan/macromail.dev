"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus, Copy, Check, Trash2, X, ShieldAlert, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type KeyListItem,
} from "@/lib/key-actions";
import type { KeyEnv, KeyScope } from "@/lib/types/db";

export function ApiKeysClient({ initialKeys }: { initialKeys: KeyListItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [name, setName] = useState("");
  const [scope, setScope] = useState<KeyScope>("full_access");
  const [env, setEnv] = useState<KeyEnv>("live");

  function create() {
    setError(null);
    start(async () => {
      const res = await createApiKeyAction({ name, scope, env });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setRevealed(res.token);
      setCreating(false);
      setName("");
      router.refresh();
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await revokeApiKeyAction(id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  async function copyToken() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-[680] tracking-[-0.01em] text-fg">API Keys</h1>
          <p className="mt-1 text-[13.5px] text-fg-muted">
            Keys authenticate REST /v1 and the MCP endpoint at /api/mcp. A token is shown once at creation — store it safely.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
          <Plus className="size-4" /> Create API key
        </Button>
      </div>

      {error && (
        <p className="mb-4 flex items-start gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-3 py-2 text-[12.5px] text-error">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      {initialKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Create a key so an agent can call REST /v1 or /api/mcp. A test key simulates internet outbound; internal mailbox delivery still runs."
        >
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Create your first key
          </Button>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-[12px] uppercase tracking-wide text-fg-faint">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Token</th>
                <th className="px-5 py-3 font-medium">Permission</th>
                <th className="px-5 py-3 font-medium">Env</th>
                <th className="px-5 py-3 font-medium">Last used</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initialKeys.map((k) => (
                <tr key={k.id} className="transition-colors hover:bg-bg-overlay/40">
                  <td className="px-5 py-3.5 font-medium text-fg">{k.name}</td>
                  <td className="px-5 py-3.5 font-mono text-fg-muted">{k.prefix}</td>
                  <td className="px-5 py-3.5">
                    <Badge tone={k.scope === "full_access" ? "accent" : "neutral"}>
                      {k.scope === "full_access" ? "Full access" : "Sending only"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge tone={k.env === "test" ? "warn" : "success"} dot>
                      {k.env}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums text-fg-muted">
                    {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => remove(k.id)}
                      disabled={pending}
                      className="rounded-md p-1.5 text-fg-faint hover:bg-error-bg hover:text-error disabled:opacity-50"
                      title="Revoke key"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} title="Create API key">
          <div className="space-y-4">
            <Field label="Name">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Production server, Claude agent"
                className="w-full rounded-[9px] border border-border bg-bg-inset px-3 py-2.5 text-[14px] text-fg outline-none placeholder:text-fg-faint focus:border-accent/50 focus:ring-2 focus:ring-accent/25"
              />
            </Field>
            <Field label="Permission">
              <div className="grid grid-cols-2 gap-2">
                {(["full_access", "sending_only"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setScope(p)}
                    className={`rounded-[9px] border px-3 py-2.5 text-left text-[13px] transition-colors ${
                      scope === p
                        ? "border-accent/50 bg-accent-bg text-fg"
                        : "border-border bg-bg-inset text-fg-muted hover:border-border-strong"
                    }`}
                  >
                    {p === "full_access" ? "Full access" : "Sending only"}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Environment">
              <div className="grid grid-cols-2 gap-2">
                {(["live", "test"] as const).map((e) => (
                  <button
                    key={e}
                    onClick={() => setEnv(e)}
                    className={`rounded-[9px] border px-3 py-2.5 text-left text-[13px] capitalize transition-colors ${
                      env === e
                        ? "border-accent/50 bg-accent-bg text-fg"
                        : "border-border bg-bg-inset text-fg-muted hover:border-border-strong"
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={create} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Create key
            </Button>
          </div>
        </Modal>
      )}

      {revealed && (
        <Modal onClose={() => setRevealed(null)} title="Save your API key">
          <div className="flex items-start gap-2.5 rounded-[10px] border border-warn/30 bg-warn-bg px-3.5 py-3 text-[13px] text-warn">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            This is the only time you’ll see this key. Copy it now and store it securely.
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-[10px] border border-border bg-bg-inset p-3">
            <code className="flex-1 break-all font-mono text-[13px] text-fg">{revealed}</code>
            <button
              onClick={copyToken}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-bg-overlay px-2.5 py-1.5 text-[12px] text-fg-muted hover:text-fg"
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="mt-4 rounded-[10px] border border-border bg-bg-inset p-3">
            <p className="mb-2 text-[12px] font-medium text-fg-muted">Use it with an AI agent (MCP):</p>
            <code className="block break-all font-mono text-[11.5px] leading-relaxed text-fg-muted">
              URL: /api/mcp
              <br />
              Header: Authorization: Bearer {revealed.slice(0, 16)}…
            </code>
          </div>
          <div className="mt-6 flex justify-end">
            <Button size="sm" onClick={() => setRevealed(null)}>
              Done — I’ve saved it
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[16px] border border-border bg-bg-raised p-6 [box-shadow:var(--shadow-lg)]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-fg-faint hover:bg-bg-overlay hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
