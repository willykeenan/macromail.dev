"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui/Logo";
import { appNavGroups } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

export function AppSidebar() {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[240px] shrink-0 flex-col border-r border-border bg-bg-base/60 md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/app/overview">
          <Logo />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {appNavGroups.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-6")}>
            {group.title && (
              <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
                {group.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[13.5px] transition-colors",
                        active
                          ? "bg-bg-overlay text-fg [box-shadow:var(--shadow-inner-hi)]"
                          : "text-fg-muted hover:bg-bg-overlay/60 hover:text-fg",
                      )}
                    >
                      <item.icon
                        className={cn("size-4", active ? "text-accent-hi" : "text-fg-faint group-hover:text-fg-muted")}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
