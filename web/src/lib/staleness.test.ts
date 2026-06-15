import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api";
import { NEUTRAL_COLOR, nextDue, stalenessTint, taskStaleness } from "@/lib/staleness";

// A small factory so each test only specifies the fields it cares about.
function task(partial: Partial<Task>): Task {
  return {
    id: 1,
    name: "t",
    description: "",
    intervalSeconds: null,
    colorFresh: null,
    colorOverdue: null,
    freezeColor: false,
    tags: [],
    folder: "",
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    lastCompletedAt: null,
    completionCount: 0,
    ownerId: 1,
    shared: false,
    lastCompletedBy: null,
    ...partial,
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK_SECONDS = 7 * 24 * 3600;

describe("taskStaleness", () => {
  it("is 'none' when the task was never completed", () => {
    expect(taskStaleness(task({}), Date.now())).toBe("none");
  });

  it("uses the cadence ratio when an interval is set", () => {
    const now = Date.now();
    const withCadence = (daysAgo: number) =>
      task({
        intervalSeconds: WEEK_SECONDS,
        lastCompletedAt: new Date(now - daysAgo * DAY).toISOString(),
      });

    expect(taskStaleness(withCadence(1), now)).toBe("fresh"); // ~0.14
    expect(taskStaleness(withCadence(5), now)).toBe("ok"); // ~0.71
    expect(taskStaleness(withCadence(6.5), now)).toBe("due-soon"); // ~0.93
    expect(taskStaleness(withCadence(8), now)).toBe("overdue"); // >1
  });

  it("falls back to absolute age when there is no cadence", () => {
    const now = Date.now();
    expect(taskStaleness(task({ lastCompletedAt: new Date(now - HOUR).toISOString() }), now)).toBe(
      "fresh",
    );
    expect(
      taskStaleness(task({ lastCompletedAt: new Date(now - 40 * DAY).toISOString() }), now),
    ).toBe("overdue");
  });
});

describe("stalenessTint", () => {
  const opts = { fresh: "#000000", overdue: "#ffffff", noRoutineFadeDays: 10 };

  it("is neutral for a never-done task", () => {
    const tint = stalenessTint(task({}), opts);
    expect(tint.color).toBe(NEUTRAL_COLOR);
    expect(tint.t).toBe(0);
  });

  it("interpolates across the cadence interval", () => {
    const now = Date.now();
    const half = task({
      intervalSeconds: WEEK_SECONDS,
      lastCompletedAt: new Date(now - 3.5 * DAY).toISOString(),
    });
    const tint = stalenessTint(half, opts, now);
    expect(tint.t).toBeCloseTo(0.5, 1);
    expect(tint.color).toBe("#808080"); // halfway black→white
  });

  it("clamps fully overdue tasks to the overdue colour", () => {
    const now = Date.now();
    const overdue = task({
      intervalSeconds: WEEK_SECONDS,
      lastCompletedAt: new Date(now - 20 * DAY).toISOString(),
    });
    expect(stalenessTint(overdue, opts, now).color).toBe("#ffffff");
  });

  it("fades a routine-less task over noRoutineFadeDays", () => {
    const now = Date.now();
    const t = task({ lastCompletedAt: new Date(now - 5 * DAY).toISOString() });
    expect(stalenessTint(t, opts, now).t).toBeCloseTo(0.5, 1); // 5 of 10 days
  });

  it("honours per-task colour overrides", () => {
    const now = Date.now();
    const t = task({
      colorFresh: "#111111",
      colorOverdue: "#222222",
      lastCompletedAt: new Date(now - HOUR).toISOString(),
    });
    const tint = stalenessTint(t, opts, now);
    expect(tint.fresh).toBe("#111111");
    expect(tint.overdue).toBe("#222222");
  });

  it("freezeColor pins an overdue task's colour to fresh", () => {
    const now = Date.now();
    // 3x past its interval — normally fully overdue (red).
    const overdue = task({ intervalSeconds: 3600, lastCompletedAt: new Date(now - 3 * HOUR).toISOString() });
    expect(stalenessTint(overdue, opts, now).color).toBe(opts.overdue);

    const frozen = task({ ...overdue, freezeColor: true });
    const tint = stalenessTint(frozen, opts, now);
    expect(tint.color).toBe(opts.fresh);
    expect(tint.key).toBe("fresh");
    expect(tint.t).toBe(0);
  });
});

describe("nextDue", () => {
  it("is null without both a cadence and a completion", () => {
    expect(nextDue(task({}))).toBeNull();
    expect(nextDue(task({ intervalSeconds: 3600 }))).toBeNull();
  });

  it("is lastCompleted + interval", () => {
    const t = task({
      intervalSeconds: 86_400,
      lastCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(nextDue(t)?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
});
