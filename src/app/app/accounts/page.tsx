import { Suspense } from "react";
import { Lock } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { listAccounts } from "@/lib/inbox/service";
import { googleConfigured } from "@/lib/inbox/google";
import { microsoftConfigured } from "@/lib/inbox/microsoft";
import { AccountsClient, type AccountView } from "@/components/inbox/AccountsClient";
import { DashboardHeader } from "@/components/app/DashboardHeader";
import { Card } from "@/components/ui/Card";

export const metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const user = await getCurrentUser();
  const rows = user ? await listAccounts(user.id) : [];
  const googleReady = googleConfigured();
  const microsoftReady = microsoftConfigured();
  const oauthReady = googleReady || microsoftReady;

  const accounts: AccountView[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    email: r.email,
    status: r.status,
    color: r.color,
    createdAt: (r.created_at ?? "").slice(0, 10),
    lastSync: r.last_sync_at,
  }));

  if (!oauthReady) {
    return (
      <>
        <DashboardHeader
          title="Connected accounts"
          description="Optional read-only Gmail or Outlook when this server has OAuth credentials. Agent mailboxes do not use OAuth — create them under Mailboxes."
        />
        <Card className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] border border-border bg-bg-overlay text-fg-muted">
              <Lock className="size-4" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-fg">OAuth is not configured on this server</h2>
              <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-fg-muted">
                Gmail and Outlook connect when the process has <code className="text-[12px] text-fg">GOOGLE_CLIENT_ID</code> /{" "}
                <code className="text-[12px] text-fg">GOOGLE_CLIENT_SECRET</code> and/or{" "}
                <code className="text-[12px] text-fg">MICROSOFT_CLIENT_ID</code> /{" "}
                <code className="text-[12px] text-fg">MICROSOFT_CLIENT_SECRET</code>. Until then those buttons stay off.
                Agent mail, SMTP outbound, API keys, and MCP do not need this.
              </p>
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <Suspense fallback={null}>
      <AccountsClient
        accounts={accounts}
        signedIn={Boolean(user)}
        googleReady={googleReady}
        microsoftReady={microsoftReady}
      />
    </Suspense>
  );
}
