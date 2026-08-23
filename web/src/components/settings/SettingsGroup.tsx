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
  children,
}: {
  /** Stable key for remembering this group's state. */
  id: string;
  title: string;
  /** One line naming what's inside, so a shut group is still discoverable. */
  summary?: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen()[id] ?? defaultOpen);

  const onToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      const next = e.currentTarget.open;
      setOpen(next);
      writeOpen(id, next);
    },
    [id],
  );

  return (
    <details open={open} onToggle={onToggle} className="group rounded-lg border">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-sm font-semibold list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        {icon && <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{title}</span>
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

/** A labelled on/off row — the shape almost every setting takes. */
export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-center justify-between gap-2 text-sm", disabled && "opacity-50")}>
      <span className="text-muted-foreground">
        {label}
        {hint && <span className="block text-xs">{hint}</span>}
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
