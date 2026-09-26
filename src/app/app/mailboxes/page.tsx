import { MailboxesClient } from "@/components/app/MailboxesClient";
import { listMailboxDomains, listMailboxMessagesAction, listUserMailboxes } from "@/lib/dashboard-actions";
import { INBOUND_NOTE } from "@/lib/mailboxes";

export const metadata = { title: "Mailboxes" };
export const dynamic = "force-dynamic";

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string }>;
}) {
  const { box } = await searchParams;
  const mailboxes = await listUserMailboxes();
  const domains = await listMailboxDomains();
  const selected =
    mailboxes.find((m) => m.address === (box ?? "").trim().toLowerCase()) ?? mailboxes[0] ?? null;
  const loaded = selected ? await listMailboxMessagesAction(selected.address) : null;
  const messages = loaded && "messages" in loaded ? loaded.messages : [];
  const note = loaded && "note" in loaded ? loaded.note : INBOUND_NOTE;

  return (
    <MailboxesClient
      mailboxes={mailboxes}
      selectedAddress={selected?.address ?? null}
      messages={messages}
      inboundNote={note}
      domains={domains}
    />
  );
}
