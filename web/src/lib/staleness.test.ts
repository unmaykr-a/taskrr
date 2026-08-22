import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api";
import { isSnoozed, NEUTRAL_COLOR, nextDue, stalenessTint, taskStaleness } from "@/lib/staleness";

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
    snoozedUntil: null,
    pinned: false,
    reminderLeadSeconds: null,
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

describe("snooze", () => {
  const later = new Date(Date.now() + 3 * DAY).toISOString();
  const earlier = new Date(Date.now() - HOUR).toISOString();

  it("recognises an active snooze and ignores an expired one", () => {
    expect(isSnoozed(task({ snoozedUntil: later }))).toBe(true);
    expect(isSnoozed(task({ snoozedUntil: earlier }))).toBe(false);
    expect(isSnoozed(task({ snoozedUntil: null }))).toBe(false);
  });

  it("takes precedence over overdue, which is the whole point", () => {
    const overdue = { lastCompletedAt: new Date(Date.now() - 30 * DAY).toISOString(), intervalSeconds: 7 * 86400 };
    expect(taskStaleness(task(overdue))).toBe("overdue");
    expect(taskStaleness(task({ ...overdue, snoozedUntil: later }))).toBe("snoozed");
  });

  it("does not hide the fact that a task has never been done", () => {
    // "Never done" is a fact about history; snoozing is about scheduling. A
    // never-done task that is snoozed reports snoozed, but once the snooze
    // expires it goes back to never-done rather than to a cadence bucket.
    expect(taskStaleness(task({ snoozedUntil: later }))).toBe("snoozed");
    expect(taskStaleness(task({ snoozedUntil: earlier }))).toBe("none");
  });

  it("reverts to the real bucket once the snooze expires", () => {
    const overdue = {
      lastCompletedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      intervalSeconds: 7 * 86400,
      snoozedUntil: earlier,
    };
    expect(taskStaleness(task(overdue))).toBe("overdue");
  });

  it("pushes the next due date out, but never pulls it forward", () => {
    const base = {
      lastCompletedAt: new Date(Date.now() - DAY).toISOString(),
      intervalSeconds: 7 * 86400, // due in ~6 days
    };
    const natural = nextDue(task(base))!;

    // A snooze beyond the natural due date wins.
    const pushed = nextDue(task({ ...base, snoozedUntil: new Date(Date.now() + 20 * DAY).toISOString() }))!;
    expect(pushed.getTime()).toBeGreaterThan(natural.getTime());

    // A snooze before it is irrelevant — snoozing must never make a task due sooner.
    const notPulled = nextDue(task({ ...base, snoozedUntil: new Date(Date.now() + HOUR).toISOString() }))!;
    expect(notPulled.getTime()).toBe(natural.getTime());
  });

  it("gives a snoozed task a due date even with no routine", () => {
    const due = nextDue(task({ snoozedUntil: later }));
    expect(due?.toISOString()).toBe(later);
  });

  it("colours a snoozed task neutrally rather than red", () => {
    const overdue = {
      lastCompletedAt: new Date(Date.now() - 30 * DAY).toISOString(),
      intervalSeconds: 7 * 86400,
    };
    const opts = { fresh: "#22c55e", overdue: "#ef4444", noRoutineFadeDays: 7 };
    expect(stalenessTint(task(overdue), opts).color).not.toBe(NEUTRAL_COLOR);
    expect(stalenessTint(task({ ...overdue, snoozedUntil: later }), opts).color).toBe(NEUTRAL_COLOR);
  });
});
