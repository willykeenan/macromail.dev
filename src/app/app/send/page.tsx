import { SendClient } from "@/components/app/SendClient";
import { EmailsTable } from "@/components/app/EmailsTable";
import { getProfileSettings, listEmails, listUserMailboxes } from "@/lib/dashboard-actions";

export const metadata = { title: "Send" };
export const dynamic = "force-dynamic";

export default async function SendPage() {
  const settings = await getProfileSettings();
  const mailboxes = await listUserMailboxes();
  const emails = await listEmails(25);
  const defaultFrom = settings.default_from || settings.smtp_user || mailboxes[0]?.address || "";

  return (
    <>
      <SendClient hasSmtp={settings.hasSmtp} defaultFrom={defaultFrom} mailboxes={mailboxes} />
      <div className="mt-8">
        <h2 className="mb-3 text-[15px] font-semibold text-fg">Recent sends</h2>
        <EmailsTable items={emails} />
      </div>
    </>
  );
}
