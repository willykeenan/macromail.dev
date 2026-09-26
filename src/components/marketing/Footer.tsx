import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { Container } from "@/components/ui/Container";
import { footerNav, site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-bg-base">
      <Container className="py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-[1.4fr_repeat(2,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Logo />
            <p className="mt-4 max-w-[280px] text-[13.5px] leading-relaxed text-fg-muted">
              {site.tagline} MIT licensed. Data stays in SQLite on the machine you run.
            </p>
            <p className="mt-5 text-[12.5px] text-fg-faint">
              A{" "}
              <Link href={site.parent.url} className="text-fg-muted underline-offset-2 hover:text-fg hover:underline">
                {site.parent.name}
              </Link>{" "}
              product.
            </p>
          </div>

          {footerNav.map((group) => (
            <div key={group.title}>
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-faint">
                {group.title}
              </h4>
              <ul className="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13.5px] text-fg-muted transition-colors hover:text-fg"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-[12.5px] text-fg-faint sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} MacroMail. MIT License.</span>
          <a
            href={site.github}
            target="_blank"
            rel="noopener noreferrer"
            className="text-fg-faint transition-colors hover:text-fg"
          >
            github.com/willykeenan/macromail.dev
          </a>
        </div>
      </Container>
    </footer>
  );
}
