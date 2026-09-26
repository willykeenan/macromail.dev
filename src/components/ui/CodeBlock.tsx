"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CodeTab {
  label: string;
  language?: string;
  code: string;
}

export function CodeBlock({
  tabs,
  filename,
  className,
  compact,
}: {
  tabs: CodeTab[];
  filename?: string;
  className?: string;
  compact?: boolean;
}) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = tabs[active] ?? tabs[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[14px] border border-border bg-bg-inset [box-shadow:var(--shadow-md)]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-bg-raised/60 pl-1.5 pr-2">
        <div className="flex items-center">
          {tabs.length > 1 ? (
            tabs.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setActive(i)}
                className={cn(
                  "relative px-3 py-2.5 text-[12.5px] font-medium transition-colors",
                  i === active ? "text-fg" : "text-fg-faint hover:text-fg-muted",
                )}
              >
                {t.label}
                {i === active && (
                  <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
                )}
              </button>
            ))
          ) : (
            <span className="flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-medium text-fg-muted">
              <span className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]/70" />
                <span className="size-2.5 rounded-full bg-[#febc2e]/70" />
                <span className="size-2.5 rounded-full bg-[#28c840]/70" />
              </span>
              {filename && <span className="ml-1 font-mono text-fg-faint">{filename}</span>}
            </span>
          )}
        </div>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-faint transition-colors hover:text-fg"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto font-mono text-[var(--text-code)] leading-[1.7] text-[#c8d3e6]",
          compact ? "p-4" : "p-5",
        )}
      >
        <code>{current.code}</code>
      </pre>
    </div>
  );
}
