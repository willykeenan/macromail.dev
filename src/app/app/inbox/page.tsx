import { getCurrentUser } from "@/lib/auth";
import { listAccounts, resolveUserAnthropicKey } from "@/lib/inbox/service";
import { googleConfigured } from "@/lib/inbox/google";
import { microsoftConfigured } from "@/lib/inbox/microsoft";
import { InboxWorkspace, type InboxAccount } from "@/components/inbox/InboxWorkspace";

export const metadata = { title: "Inbox" };
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await getCurrentUser();
  const rows = user ? await listAccounts(user.id) : [];

  const accounts: InboxAccount[] = rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    email: r.email,
    color: r.color,
    status: r.status,
  }));

  const serverAiEnabled = user ? Boolean(await resolveUserAnthropicKey(user.id)) : false;
  const oauthReady = googleConfigured() || microsoftConfigured();

  return (
    <InboxWorkspace
      accounts={accounts}
      signedIn={Boolean(user)}
      serverAiEnabled={serverAiEnabled}
      oauthReady={oauthReady}
    />
  );
}
