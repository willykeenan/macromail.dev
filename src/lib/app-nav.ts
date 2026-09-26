import type { LucideIcon } from "lucide-react";
import {
  Inbox,
  KeyRound,
  LayoutDashboard,
  Mail,
  Plug,
  Send,
  Settings,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const appNavGroups: { title?: string; items: NavItem[] }[] = [
  {
    title: "Mail",
    items: [
      { label: "Overview", href: "/app/overview", icon: LayoutDashboard },
      { label: "Mailboxes", href: "/app/mailboxes", icon: Mail },
      { label: "Inbox", href: "/app/inbox", icon: Inbox },
      { label: "Send", href: "/app/send", icon: Send },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "API keys", href: "/app/api-keys", icon: KeyRound },
      { label: "Accounts", href: "/app/accounts", icon: Plug },
      { label: "Settings", href: "/app/settings", icon: Settings },
    ],
  },
];
