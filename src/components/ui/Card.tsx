import { cn } from "@/lib/utils";

export function Card({
  className,
  interactive,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[14px] border border-border bg-bg-raised [box-shadow:var(--shadow-inner-hi)]",
        interactive &&
          "transition-all duration-200 ease-[cubic-bezier(.2,.8,.2,1)] hover:border-border-strong hover:-translate-y-0.5 hover:[box-shadow:var(--shadow-md),var(--shadow-inner-hi)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
