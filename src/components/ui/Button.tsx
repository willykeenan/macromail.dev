import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "subtle";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap rounded-[10px] " +
  "transition-all duration-150 ease-[cubic-bezier(.2,.8,.2,1)] outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/55 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base " +
  "disabled:opacity-50 disabled:pointer-events-none select-none";

const variants: Record<Variant, string> = {
  primary:
    "text-white border border-white/10 [background:var(--gradient-btn)] shadow-[var(--shadow-glow)] hover:brightness-110 active:brightness-95",
  secondary:
    "bg-bg-overlay text-fg border border-border-strong hover:border-fg-faint hover:bg-[#1a1e26] [box-shadow:var(--shadow-inner-hi)]",
  ghost:
    "text-fg-muted hover:text-fg hover:bg-bg-overlay border border-transparent",
  subtle:
    "bg-bg-raised text-fg border border-border hover:border-border-strong",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-[14px]",
  lg: "h-12 px-6 text-[15px]",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

export function Button(
  props: CommonProps &
    (
      | ({ href: string; external?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>)
      | ({ href?: undefined } & React.ButtonHTMLAttributes<HTMLButtonElement>)
    ),
) {
  const { variant = "primary", size = "md", className, children, ...rest } = props;
  const cls = cn(base, variants[variant], sizes[size], className);

  if ("href" in rest && rest.href) {
    const { href, external, ...anchorRest } = rest as {
      href: string;
      external?: boolean;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>;
    if (external || href.startsWith("http")) {
      return (
        <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...anchorRest}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls} {...anchorRest}>
        {children}
      </Link>
    );
  }

  return (
    <button className={cls} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
