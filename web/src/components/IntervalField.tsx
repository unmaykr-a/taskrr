import { useEffect, useId, useState } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// The units the user can pick from. Everything is stored as seconds in the DB;
// these are just convenient multiples for the UI.
const UNITS = [
  { label: "hours", seconds: 3_600 },
  { label: "days", seconds: 86_400 },
  { label: "weeks", seconds: 604_800 },
] as const;

/** Given a cadence in seconds, pick the nicest {amount, unit} to display it as. */
function decompose(seconds: number): { amount: number; unitSeconds: number } {
  // Prefer the largest unit that divides evenly (e.g. 604800 -> 1 week).
  for (let i = UNITS.length - 1; i >= 0; i--) {
    const u = UNITS[i];
    if (seconds % u.seconds === 0) return { amount: seconds / u.seconds, unitSeconds: u.seconds };
  }
  return { amount: Math.max(1, Math.round(seconds / 86_400)), unitSeconds: 86_400 };
}

/**
 * IntervalField lets the user optionally attach a cadence ("every N hours/days/
 * weeks") to a task. `value` is seconds or null; `onChange` reports the new
 * seconds (or null when the routine is turned off).
 *
 * It's a "controlled" component: it holds local UI state for the number/unit but
 * always pushes the resolved value up via onChange, so the parent form owns the
 * source of truth.
 */
export function IntervalField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (seconds: number | null) => void;
}) {
  const initial = value ? decompose(value) : { amount: 7, unitSeconds: 86_400 };
  const [enabled, setEnabled] = useState(value != null);
  const [amount, setAmount] = useState(initial.amount);
  const [unitSeconds, setUnitSeconds] = useState(initial.unitSeconds);
  const checkboxId = useId();

  // Whenever the inputs change, resolve and report the value upward. A cleared
  // or non-numeric number input reads as NaN, which would otherwise propagate
  // (NaN serialises to null and silently dropped the cadence) — treat it as 1.
  useEffect(() => {
    const n = Number.isFinite(amount) ? Math.max(1, Math.round(amount)) : 1;
    onChange(enabled ? n * unitSeconds : null);
    // We intentionally exclude onChange from deps; it may be a new function each
    // render and we only want to react to the actual input values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, amount, unitSeconds]);

  return (
    <div className="space-y-2">
      <label htmlFor={checkboxId} className="flex items-center gap-2 text-sm font-medium">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-input bg-transparent accent-primary"
        />
        Routine
      </label>

      <div className={cn("flex items-center gap-2 transition-opacity", !enabled && "pointer-events-none opacity-40")}>
        <span className="text-sm text-muted-foreground">every</span>
        <Input
          type="number"
          min={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-20"
          disabled={!enabled}
          aria-label="Interval amount"
        />
        <select
          value={unitSeconds}
          onChange={(e) => setUnitSeconds(Number(e.target.value))}
          disabled={!enabled}
          aria-label="Interval unit"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {UNITS.map((u) => (
            <option key={u.label} value={u.seconds} className="bg-background">
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
