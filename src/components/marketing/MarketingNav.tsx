"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, GitFork } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { mainNav, site } from "@/lib/site";

export function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-200",
        scrolled ? "border-b border-border bg-bg-base/80 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <nav className="mx-auto flex h-16 w-full max-w-[1140px] items-center justify-between px-6">
        <Link href="/" className="transition-opacity hover:opacity-90">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-[14px] text-fg-muted transition-colors hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2.5 md:flex">
          <Button href="/login" variant="ghost" size="sm">
            Sign in
          </Button>
          <Button href={site.github} variant="primary" size="sm">
            <GitFork className="size-4" />
            GitHub
          </Button>
        </div>

        <button
          className="grid size-9 place-items-center rounded-md text-fg-muted hover:bg-bg-overlay md:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-border bg-bg-base/95 px-6 py-4 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2.5 text-[15px] text-fg-muted hover:bg-bg-overlay hover:text-fg"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex gap-2">
              <Button href="/login" variant="secondary" size="md" className="flex-1">
                Sign in
              </Button>
              <Button href={site.github} variant="primary" size="md" className="flex-1">
                GitHub
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
