// staleness.ts — the single source of truth for "how overdue is this task?".
//
// This is deliberately isolated so the whole colour/scheduling policy can be
// tuned (or swapped for an experiment) in ONE file without touching components.
// It is pure (no React, no DOM), which also makes it trivial to unit-test —
// see staleness.test.ts.

import type { Task } from "./api";
import { mixHex } from "./color";

/** The five staleness buckets a task can be in. */
export type Staleness = "none" | "fresh" | "ok" | "due-soon" | "overdue";

export interface StalenessStyle {
  key: Staleness;
  label: string;
  /** Tailwind bg class for the card's top accent bar. */
  bar: string;
  /** Tailwind bg class for the status dot. */
  dot: string;
  /** Tailwind text colour for emphasis. */
  text: string;
}

// Visual + label mapping. Semantic colours (green→red) are intentionally
// independent of the app's rose accent.
const STYLES: Record<Staleness, StalenessStyle> = {
  none: { key: "none", label: "Never done", bar: "bg-zinc-500/50", dot: "bg-zinc-400", text: "text-zinc-400" },
  fresh: { key: "fresh", label: "Fresh", bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-400" },
  ok: { key: "ok", label: "On track", bar: "bg-sky-500", dot: "bg-sky-500", text: "text-sky-400" },
  "due-soon": { key: "due-soon", label: "Due soon", bar: "bg-amber-500", dot: "bg-amber-500", text: "text-amber-400" },
  overdue: { key: "overdue", label: "Overdue", bar: "bg-rose-500", dot: "bg-rose-500", text: "text-rose-400" },
};

// --- Tunable thresholds -----------------------------------------------------

/**
 * When a task HAS a cadence, staleness is measured as the fraction of the
 * interval that has elapsed since the last completion (age / interval):
 *   < 0.5  fresh · < 0.85 on track · < 1.0 due soon · >= 1.0 overdue
 */
export const CADENCE_THRESHOLDS = { fresh: 0.5, ok: 0.85, dueSoon: 1.0 };

/**
 * When a task has NO cadence, we fall back to absolute age in days so the
 * colours still mean something:
 *   < 2d fresh · < 7d on track · < 30d due soon · >= 30d overdue
 */
export const ABSOLUTE_DAYS = { fresh: 2, ok: 7, dueSoon: 30 };

const SECONDS_PER_DAY = 86_400;

// --- Public API -------------------------------------------------------------

/** Classify a task into a staleness bucket at the given moment. */
export function taskStaleness(task: Task, now: number = Date.now()): Staleness {
  if (!task.lastCompletedAt) return "none";

  const ageSeconds = (now - new Date(task.lastCompletedAt).getTime()) / 1000;

  if (task.intervalSeconds && task.intervalSeconds > 0) {
    const ratio = ageSeconds / task.intervalSeconds;
    if (ratio < CADENCE_THRESHOLDS.fresh) return "fresh";
    if (ratio < CADENCE_THRESHOLDS.ok) return "ok";
    if (ratio < CADENCE_THRESHOLDS.dueSoon) return "due-soon";
    return "overdue";
  }

  const ageDays = ageSeconds / SECONDS_PER_DAY;
  if (ageDays < ABSOLUTE_DAYS.fresh) return "fresh";
  if (ageDays < ABSOLUTE_DAYS.ok) return "ok";
  if (ageDays < ABSOLUTE_DAYS.dueSoon) return "due-soon";
  return "overdue";
}

/** Convenience: the visual style for a task's current staleness. */
export function stalenessStyle(task: Task, now?: number): StalenessStyle {
  return STYLES[taskStaleness(task, now)];
}

/** The next due date (lastCompleted + interval), or null if no cadence/history. */
export function nextDue(task: Task): Date | null {
  if (!task.lastCompletedAt || !task.intervalSeconds) return null;
  return new Date(new Date(task.lastCompletedAt).getTime() + task.intervalSeconds * 1000);
}

/**
 * Fraction (0..>1) through the interval, for an optional progress bar.
 * null when the task has no cadence or has never been done.
 */
export function cadenceProgress(task: Task, now: number = Date.now()): number | null {
  if (!task.lastCompletedAt || !task.intervalSeconds) return null;
  const ageSeconds = (now - new Date(task.lastCompletedAt).getTime()) / 1000;
  return ageSeconds / task.intervalSeconds;
}

// --- continuous (gradient) colour -------------------------------------------

/** The colour shown for a never-done task (independent of fresh/overdue). */
export const NEUTRAL_COLOR = "#a1a1aa"; // zinc-400

export interface StalenessTintOptions {
  /** App-wide default colours, overridden per-task when set. */
  fresh: string;
  overdue: string;
  /** Days over which a no-cadence task fades fully to `overdue`. */
  noRoutineFadeDays: number;
  /** When true, no task fades — every task stays at its fresh colour (the
   *  per-user "disable colour fade" preference, equivalent to freeze-colour on
   *  every task). Cadence, due dates, and filters are unaffected. */
  disableFade?: boolean;
}

export interface StalenessTint {
  key: Staleness;
  label: string;
  /** The interpolated colour at `t` (fresh → overdue). */
  color: string;
  /** Resolved endpoint colours (per-task override or default). */
  fresh: string;
  overdue: string;
  /** 0..1 position along the gradient (0 = just done, 1 = fully overdue). */
  t: number;
  /** Cadence progress for the bar (may exceed 1); null without a cadence. */
  progress: number | null;
}

/**
 * stalenessTint resolves a task to a *continuous* colour by interpolating
 * between its fresh and overdue colours as time passes — rather than snapping
 * between five fixed buckets. Cadence tasks fade across their interval;
 * cadence-less tasks fade over `noRoutineFadeDays` (default a week). Never-done
 * tasks get a neutral colour.
 *
 * Per-task overrides (task.colorFresh / colorOverdue) win over the defaults, so
 * each task can be coloured individually. Kept pure (options passed in) so it
 * stays unit-testable and independent of the prefs store.
 */
export function stalenessTint(
  task: Task,
  opts: StalenessTintOptions,
  now: number = Date.now(),
): StalenessTint {
  const key = taskStaleness(task, now);
  const label = STYLES[key].label;
  const fresh = task.colorFresh ?? opts.fresh;
  const overdue = task.colorOverdue ?? opts.overdue;

  if (key === "none" || !task.lastCompletedAt) {
    return { key, label, color: NEUTRAL_COLOR, fresh, overdue, t: 0, progress: null };
  }

  // "Stay green": pin the colour (and the displayed bucket) to fresh, regardless
  // of how overdue the task actually is. Cadence/due/filters are untouched.
  // Triggered per-task (freezeColor) or globally (the disableFade preference).
  if (task.freezeColor || opts.disableFade) {
    return {
      key: "fresh",
      label: STYLES.fresh.label,
      color: fresh,
      fresh,
      overdue,
      t: 0,
      progress: cadenceProgress(task, now),
    };
  }

  const ageSeconds = (now - new Date(task.lastCompletedAt).getTime()) / 1000;
  let t: number;
  if (task.intervalSeconds && task.intervalSeconds > 0) {
    t = ageSeconds / task.intervalSeconds;
  } else {
    const days = Math.max(0.0001, opts.noRoutineFadeDays);
    t = ageSeconds / SECONDS_PER_DAY / days;
  }
  t = Math.min(1, Math.max(0, t));

  return {
    key,
    label,
    color: mixHex(fresh, overdue, t),
    fresh,
    overdue,
    t,
    progress: cadenceProgress(task, now),
  };
}
