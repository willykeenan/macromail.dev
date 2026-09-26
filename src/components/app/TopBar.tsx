"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { logoutAction } from "@/lib/auth-actions";
import { appNavGroups } from "@/lib/app-nav";
import { cn } from "@/lib/utils";

export function TopBar({ userEmail }: { userEmail: string | null }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = (userEmail?.[0] ?? "M").toUpperCase();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg-base/85 backdrop-blur-xl">
      <div className="flex h-[57px] items-center justify-between gap-3 px-4 sm:px-5">
        <Link
          href="/app/overview"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-raised px-3 py-1.5 text-[12px] font-medium text-fg-muted"
        >
          <span className="size-2 rounded-full bg-success" />
          Signed in
        </Link>
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--gradient-btn)] text-[12px] font-semibold text-white"
            title={userEmail ?? undefined}
          >
            {initial}
          </div>
          {userEmail && (
            <span className="hidden max-w-[180px] truncate text-[12.5px] text-fg-muted sm:inline">
              {userEmail}
            </span>
          )}
          <form action={logoutAction}>
            <button
              type="submit"
              className="grid size-8 place-items-center rounded-md text-fg-faint hover:bg-bg-overlay hover:text-fg"
              title="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </form>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-bg-overlay hover:text-fg md:hidden"
            aria-label={menuOpen ? "Close portal menu" : "Open portal menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav className="border-t border-border bg-bg-base px-4 py-4 md:hidden" aria-label="Portal navigation">
          {appNavGroups.map((group) => (
            <div key={group.title} className="mb-4 last:mb-0">
              <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[.14em] text-fg-faint">
                {group.title}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-[9px] border px-3 py-2.5 text-[12.5px]",
                        active
                          ? "border-accent/30 bg-accent-bg text-accent-hi"
                          : "border-border bg-bg-raised text-fg-muted",
                      )}
                    >
                      <item.icon className="size-3.5" /> {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      )}
    </header>
  );
}
