import { type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";

/**
 * Segmented is a small multi-option toggle where the filled pill glides to the
 * selected option (same sliding-bubble treatment as the sidebar views and the
 * login tabs). Use it for 2-4 short, mutually exclusive choices.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  /** Labels can be nodes, not just text — an icon beside the word is common
   *  enough (light/dark) that spelling it out here beats a second component. */
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={cn(
        "relative grid auto-cols-fr grid-flow-col gap-1 rounded-lg border bg-muted/40 p-1 text-xs",
        className,
      )}
    >
      <SlidingHighlight containerRef={ref} activeKey={value} className="rounded-md bg-primary" />
      {options.map((o) => (
        <button
          key={o.value}
          data-slide-key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "relative flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 transition-colors duration-200",
            value === o.value ? "font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
