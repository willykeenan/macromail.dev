import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

/**
 * Honest stat tile. `value` renders exactly what it's given — a real `0` or a
 * `—` for an undefined rate. It NEVER fabricates a number or a trend.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const isZeroish = value === 0 || value === "0" || value === "—";
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-fg-muted">{label}</span>
        {Icon && <Icon className="size-4 text-fg-faint" />}
      </div>
      <div className={cn("mt-3 text-[28px] font-[680] tracking-tight tabular-nums", isZeroish ? "text-fg-faint" : "text-fg")}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[12px] text-fg-faint">{hint}</div>}
    </Card>
  );
}
