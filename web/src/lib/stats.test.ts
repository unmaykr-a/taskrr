import { describe, expect, it } from "vitest";

import type { Completion } from "@/lib/api";
import { PACE_LABELS, paceVerdict, taskStats } from "@/lib/stats";
import { formatGap } from "@/lib/time";

const DAY = 86_400_000;
const BASE = Date.parse("2026-01-01T12:00:00Z");

/** Completions at the given day offsets from a fixed base. */
function logs(...dayOffsets: number[]): Completion[] {
  return dayOffsets.map((d, i) => ({
    id: i + 1,
    taskId: 1,
    completedAt: new Date(BASE + d * DAY).toISOString(),
    note: "",
    userId: 1,
    createdAt: new Date(BASE + d * DAY).toISOString(),
  }));
}

describe("taskStats", () => {
  it("returns an empty summary for no history", () => {
    for (const input of [undefined, []]) {
      const s = taskStats(input);
      expect(s.count).toBe(0);
      expect(s.first).toBeNull();
      expect(s.typicalGapMs).toBeNull();
    }
  });

  it("reports a single completion without inventing a rhythm", () => {
    const s = taskStats(logs(0));
    expect(s.count).toBe(1);
    expect(s.first?.getTime()).toBe(BASE);
    expect(s.last?.getTime()).toBe(BASE);
    // One data point says nothing about cadence.
    expect(s.gaps).toEqual([]);
    expect(s.typicalGapMs).toBeNull();
    expect(s.longestGapMs).toBeNull();
  });

  it("sorts input, so newest-first API order is handled", () => {
    const ascending = taskStats(logs(0, 7, 14));
    const descending = taskStats(logs(14, 7, 0));
    expect(descending).toEqual(ascending);
    expect(descending.first?.getTime()).toBe(BASE);
    expect(descending.last?.getTime()).toBe(BASE + 14 * DAY);
  });

  it("measures gaps between consecutive completions", () => {
    const s = taskStats(logs(0, 3, 13));
    expect(s.count).toBe(3);
    expect(s.gaps).toEqual([3 * DAY, 10 * DAY]);
    expect(s.shortestGapMs).toBe(3 * DAY);
    expect(s.longestGapMs).toBe(10 * DAY);
    expect(s.averageGapMs).toBe(6.5 * DAY);
  });

  it("uses the median so one outlier doesn't redefine normal", () => {
    // Four 7-day gaps and one 100-day holiday.
    const s = taskStats(logs(0, 7, 14, 21, 28, 128));
    expect(s.typicalGapMs).toBe(7 * DAY);
    // The mean is dragged far off by the same outlier — that's the point.
    expect(s.averageGapMs).toBeGreaterThan(20 * DAY);
  });

  it("averages the middle two gaps when there is an even number", () => {
    const s = taskStats(logs(0, 2, 6, 12));
    expect(s.gaps).toEqual([2 * DAY, 4 * DAY, 6 * DAY]);
    expect(s.typicalGapMs).toBe(4 * DAY);
  });

  it("leaves cadence-relative fields null without a routine", () => {
    const s = taskStats(logs(0, 7, 14));
    expect(s.onTimeRate).toBeNull();
    expect(s.paceRatio).toBeNull();
  });

  it("scores on-time rate and pace against a routine", () => {
    // Gaps of 5, 10, 5, 10 days against a 7-day cadence: half are within it.
    const s = taskStats(logs(0, 5, 15, 20, 30), 7 * 86_400);
    expect(s.onTimeRate).toBeCloseTo(0.5, 5);
    // Median gap is 7.5d against a 7d cadence.
    expect(s.paceRatio).toBeCloseTo(7.5 / 7, 5);
  });

  it("counts a gap exactly on the cadence as on time", () => {
    const s = taskStats(logs(0, 7), 7 * 86_400);
    expect(s.onTimeRate).toBe(1);
    expect(s.paceRatio).toBe(1);
  });

  it("ignores an unparseable timestamp rather than producing NaN", () => {
    const bad: Completion[] = [
      ...logs(0, 7),
      { id: 9, taskId: 1, completedAt: "not-a-date", note: "", userId: 1, createdAt: "" },
    ];
    const s = taskStats(bad);
    expect(s.count).toBe(2);
    expect(Number.isFinite(s.typicalGapMs!)).toBe(true);
  });

  it("treats a zero or negative cadence as no routine", () => {
    expect(taskStats(logs(0, 7), 0).paceRatio).toBeNull();
    expect(taskStats(logs(0, 7), null).paceRatio).toBeNull();
  });
});

describe("paceVerdict", () => {
  it("is null without a routine", () => {
    expect(paceVerdict(null)).toBeNull();
  });

  it("bands the ratio forgivingly around 1", () => {
    expect(paceVerdict(0.5)).toBe("ahead");
    expect(paceVerdict(0.9)).toBe("on-track");
    expect(paceVerdict(1.0)).toBe("on-track");
    expect(paceVerdict(1.15)).toBe("on-track");
    expect(paceVerdict(1.3)).toBe("behind");
    expect(paceVerdict(2)).toBe("well-behind");
  });

  it("has a label for every verdict", () => {
    for (const r of [0.5, 1, 1.3, 2]) {
      expect(PACE_LABELS[paceVerdict(r)!]).toBeTruthy();
    }
  });
});

describe("formatGap (the stats-facing duration format)", () => {
  it("keeps days as the unit past a fortnight, so near spans stay distinct", () => {
    // The case that motivated it: humanizeDuration renders both as "2 weeks",
    // which made the pace sentence contradict itself.
    expect(formatGap(18 * DAY)).toBe("18 days");
    expect(formatGap(14 * DAY)).toBe("14 days");
    expect(formatGap(18 * DAY)).not.toBe(formatGap(14 * DAY));
  });

  it("steps down to hours and minutes for short spans", () => {
    expect(formatGap(90 * 1000)).toBe("2 minutes");
    expect(formatGap(5 * 3_600_000)).toBe("5 hours");
    expect(formatGap(30 * 3_600_000)).toBe("30 hours");
  });

  it("steps up to months and years for long ones", () => {
    expect(formatGap(90 * DAY)).toBe("3 months");
    expect(formatGap(400 * DAY)).toBe("13 months");
    expect(formatGap(1000 * DAY)).toBe("3 years");
  });

  it("singularises a value of one", () => {
    expect(formatGap(60_000)).toBe("1 minute");
    expect(formatGap(3_600_000)).toBe("1 hour");
  });

  it("prefers resolution over a rounder unit around the day mark", () => {
    // Each range hands over above its own unit's "1", so a gap never degrades
    // to a single unit that hides a big relative difference: 24h and 30h stay
    // distinguishable as hours instead of both collapsing to "1 day".
    expect(formatGap(DAY)).toBe("24 hours");
    expect(formatGap(30 * 3_600_000)).toBe("30 hours");
    expect(formatGap(740 * DAY)).toBe("2 years");
  });

  it("hands off between units at the documented thresholds", () => {
    // 36h is the hours→days boundary; 60d is days→months.
    expect(formatGap(35 * 3_600_000)).toBe("35 hours");
    expect(formatGap(37 * 3_600_000)).toBe("2 days");
    expect(formatGap(59 * DAY)).toBe("59 days");
    expect(formatGap(60 * DAY)).toBe("2 months");
  });
});
