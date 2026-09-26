import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The honest zero-state. Used everywhere a fresh account has no data yet —
 * a designed, reassuring guide toward the next action, never a fake metric.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[14px] border border-dashed border-border-strong bg-bg-raised/40 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="mb-4 grid size-12 place-items-center rounded-[12px] border border-border bg-bg-overlay text-accent-hi [box-shadow:var(--shadow-inner-hi)]">
        <Icon className="size-5" />
      </div>
      <h3 className="text-[16px] font-semibold text-fg">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[13.5px] text-fg-muted">{description}</p>
      {children && <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  );
}
