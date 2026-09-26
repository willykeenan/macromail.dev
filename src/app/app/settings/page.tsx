import { DashboardHeader } from "@/components/app/DashboardHeader";
import { SettingsForms } from "@/components/app/SettingsForms";
import { getProfileSettings } from "@/lib/dashboard-actions";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getProfileSettings();
  return (
    <>
      <DashboardHeader
        title="Settings"
        description="Your SMTP account for outbound mail, your Anthropic key for triage and drafts, and this account's password."
      />
      <SettingsForms settings={settings} />
    </>
  );
}
