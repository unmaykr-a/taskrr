// stats.ts — what a task's own history says about it.
//
// Every completion is already stored with a timestamp, so the interesting
// numbers ("you actually do this every 9 days, though you aim for 7") are pure
// derivations — no schema, no endpoint, no extra request beyond the history the
// Manage window already fetches. Kept pure and free of React so the policy can
// be tuned and unit-tested in one place (see stats.test.ts).

import type { Completion } from "./api";

export interface TaskStats {
  /** Number of completions logged. */
  count: number;
  /** Oldest and newest completion, or null when there are none. */
  first: Date | null;
  last: Date | null;
  /**
   * Gaps between consecutive completions, oldest first, in milliseconds.
   * A task logged N times has N-1 gaps — one completion tells you nothing
   * about rhythm, which is why most fields below stay null until there are two.
   */
  gaps: number[];
  /**
   * Typical gap. The median rather than the mean: one holiday, or one burst of
   * catching up, shouldn't redefine what "normal" looks like for the task.
   */
  typicalGapMs: number | null;
  /** Mean gap — kept alongside the median so a skew is visible if you want it. */
  averageGapMs: number | null;
  longestGapMs: number | null;
  shortestGapMs: number | null;
  /**
   * With a routine: the share of gaps that came in within the cadence (0..1).
   * Null without a routine, or with fewer than two completions.
   */
  onTimeRate: number | null;
  /**
   * With a routine: typical gap ÷ cadence. 1 is exactly on rhythm, 1.5 means
   * it takes half again as long as intended, 0.8 means you do it early.
   */
  paceRatio: number | null;
}

const EMPTY: TaskStats = {
  count: 0,
  first: null,
  last: null,
  gaps: [],
  typicalGapMs: null,
  averageGapMs: null,
  longestGapMs: null,
  shortestGapMs: null,
  onTimeRate: null,
  paceRatio: null,
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Summarise a task's completion history.
 *
 * `completions` may arrive in any order (the API returns newest first); they're
 * sorted here so callers never have to think about it. `intervalSeconds` is the
 * task's cadence, or null/undefined for a task that just tracks.
 */
export function taskStats(
  completions: Completion[] | undefined,
  intervalSeconds?: number | null,
): TaskStats {
  if (!completions || completions.length === 0) return EMPTY;

  const times = completions
    .map((c) => new Date(c.completedAt).getTime())
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (times.length === 0) return EMPTY;

  const first = new Date(times[0]);
  const last = new Date(times[times.length - 1]);
  if (times.length === 1) {
    return { ...EMPTY, count: 1, first, last };
  }

  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
  const ascending = [...gaps].sort((a, b) => a - b);

  const typicalGapMs = median(ascending);
  const averageGapMs = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;

  let onTimeRate: number | null = null;
  let paceRatio: number | null = null;
  if (intervalSeconds && intervalSeconds > 0) {
    const cadenceMs = intervalSeconds * 1000;
    onTimeRate = gaps.filter((g) => g <= cadenceMs).length / gaps.length;
    paceRatio = typicalGapMs / cadenceMs;
  }

  return {
    count: times.length,
    first,
    last,
    gaps,
    typicalGapMs,
    averageGapMs,
    longestGapMs: ascending[ascending.length - 1],
    shortestGapMs: ascending[0],
    onTimeRate,
    paceRatio,
  };
}

/**
 * A short verdict on how the real rhythm compares to the intended one, for the
 * routine case. The bands are deliberately forgiving — this is a nudge on a
 * card, not a performance review, and being a few percent off your own made-up
 * cadence is not worth flagging.
 */
export type PaceVerdict = "ahead" | "on-track" | "behind" | "well-behind";

export function paceVerdict(paceRatio: number | null): PaceVerdict | null {
  if (paceRatio == null) return null;
  if (paceRatio < 0.85) return "ahead";
  if (paceRatio <= 1.15) return "on-track";
  if (paceRatio <= 1.5) return "behind";
  return "well-behind";
}

export const PACE_LABELS: Record<PaceVerdict, string> = {
  ahead: "ahead of your routine",
  "on-track": "right on your routine",
  behind: "a little behind your routine",
  "well-behind": "well behind your routine",
};
