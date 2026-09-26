import { cn } from "@/lib/utils";

/** MacroMail brand mark: a gradient tile with an "M" cut as an envelope flight path. */
export function LogoMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="mm-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7AA2FF" />
          <stop offset="0.5" stopColor="#5B8CFF" />
          <stop offset="1" stopColor="#9B6BFF" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.25" fill="url(#mm-grad)" />
      <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="8.25" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" />
      {/* envelope "M" path */}
      <path
        d="M7 22V11.2c0-.7.83-1.07 1.35-.6L16 17.4l7.65-6.8c.52-.47 1.35-.1 1.35.6V22"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="16" cy="20.4" r="1.7" fill="white" />
    </svg>
  );
}

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {withWordmark && (
        <span className="text-[17px] font-semibold tracking-tight text-fg">
          Macro<span className="text-fg-muted">Mail</span>
        </span>
      )}
    </span>
  );
}
