import { type ReactNode, useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * SettingsGroup — one collapsible group in a settings pane.
 *
 * The settings panes had grown into long walls of switches with three different
 * disclosure styles between them (a bare marker in Preferences, a chevron in
 * Account, a chevron and an icon in Reminders). This is the one of those worth
 * keeping, in one place, so a settings pane is a short list of groups you open
 * rather than a page you scroll looking for the thing you came for.
 *
 * Open/closed is remembered per group, in localStorage rather than in the
 * synced preferences: which drawer you left open is a property of the screen
 * you're sitting at, not of your account.
 */

const OPEN_KEY = "taskrr-settings-open";

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {}; // storage disabled, or someone put junk in it
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: open }));
  } catch {
    // storage unavailable — the group still opens, it just won't be remembered
  }
}

export function SettingsGroup({
  id,
  title,
  summary,
  icon,
  defaultOpen = false,
  flat = false,
  badge,
  onOpenChange,
  children,
}: {
  /** Stable key for remembering this group's state. */
  id: string;
  title: string;
  /** One line naming what's inside, so a shut group is still discoverable.
   *  A node rather than a string, so a count badge can live here too. */
  summary?: ReactNode;
  icon?: ReactNode;
  /** A status shown beside the title, open or shut — unlike `summary`, which is
   *  a description of what's inside and only useful while the group is closed. */
  badge?: ReactNode;
  defaultOpen?: boolean;
  /**
   * Render as a plain section rather than a drawer.
   *
   * A pane where *everything* is shut reads as tidy and behaves as a wall of
   * closed doors. The one or two groups you'd open on almost every visit — the
   * clock, who you're signed in as — are better left out in the open, so the
   * pane still shows something when it opens.
   */
  flat?: boolean;
  /** For a group whose contents are expensive enough to build only when shown. */
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen()[id] ?? defaultOpen);

  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = e.currentTarget.open;
      setOpen(next);
      writeOpen(id, next);
      onOpenChange?.(next);
    },
    [id, onOpenChange],
  );

  if (flat) {
    return (
      <section className="space-y-2.5 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {badge && <span className="shrink-0 text-xs font-normal">{badge}</span>}
        </h3>
        {children}
      </section>
    );
  }

  return (
    <details open={open} onToggle={onToggle} className="group rounded-lg border">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-sm font-semibold list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {badge && <span className="shrink-0 text-xs font-normal">{badge}</span>}
        {/* Only while shut: once it's open the controls say it better, and a
            summary line alongside them is just noise. Driven from state rather
            than a group-open: variant, which would collide with the sm: one. */}
        {summary && !open && (
          <span className="hidden truncate text-xs font-normal text-muted-foreground sm:inline">
            {summary}
          </span>
        )}
      </summary>
      <div className={cn("space-y-2.5 border-t p-3")}>{children}</div>
    </details>
  );
}
