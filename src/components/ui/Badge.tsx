import { cn } from "@/lib/utils";
import type { EmailStatus } from "@/lib/email/types";

type Tone = "neutral" | "accent" | "success" | "warn" | "error" | "mono";

const tones: Record<Tone, string> = {
  neutral: "bg-bg-overlay text-fg-muted border-border-strong",
  accent: "bg-accent-bg text-accent-hi border-accent/30",
  success: "bg-success-bg text-success border-success/30",
  warn: "bg-warn-bg text-warn border-warn/30",
  error: "bg-error-bg text-error border-error/30",
  mono: "bg-bg-inset text-fg-muted border-border font-mono",
};

export function Badge({
  tone = "neutral",
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-medium leading-5",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const statusTone: Record<EmailStatus, Tone> = {
  queued: "warn",
  scheduled: "warn",
  sent: "accent",
  delivered: "success",
  opened: "success",
  clicked: "success",
  delivery_delayed: "warn",
  bounced: "error",
  complained: "error",
  canceled: "neutral",
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  return (
    <Badge tone={statusTone[status]} dot>
      {status.replace("_", " ")}
    </Badge>
  );
}

export function StatusDot({ status, className }: { status: EmailStatus; className?: string }) {
  const color: Record<Tone, string> = {
    neutral: "bg-fg-faint",
    accent: "bg-accent",
    success: "bg-success",
    warn: "bg-warn",
    error: "bg-error",
    mono: "bg-fg-faint",
  };
  return <span className={cn("size-2 rounded-full", color[statusTone[status]], className)} />;
}
