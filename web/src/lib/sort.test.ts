import { describe, expect, it } from "vitest";

import type { Task } from "@/lib/api";
import { sortTasks } from "@/lib/sort";

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
    rotate: false,
    reminderLeadSeconds: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastCompletedAt: null,
    completionCount: 0,
    ownerId: 1,
    shared: false,
    lastCompletedBy: null,
    ...partial,
  };
}

const names = (list: Task[]) => list.map((t) => t.name);

describe("sortTasks", () => {
  const alpha = task({ id: 1, name: "alpha", lastCompletedAt: "2026-01-03T00:00:00Z" });
  const bravo = task({ id: 2, name: "bravo", lastCompletedAt: "2026-01-01T00:00:00Z" });
  const charlie = task({ id: 3, name: "charlie", lastCompletedAt: "2026-01-02T00:00:00Z" });
  const list = [charlie, alpha, bravo];

  it("does not mutate the input", () => {
    const input = [...list];
    sortTasks(input, "name");
    expect(input).toEqual(list);
  });

  it("orders by name, recency and staleness", () => {
    expect(names(sortTasks(list, "name"))).toEqual(["alpha", "bravo", "charlie"]);
    expect(names(sortTasks(list, "recent"))).toEqual(["alpha", "charlie", "bravo"]);
    expect(names(sortTasks(list, "stale"))).toEqual(["bravo", "charlie", "alpha"]);
  });

  it("leaves the server's order alone for 'smart'", () => {
    expect(names(sortTasks(list, "smart"))).toEqual(["charlie", "alpha", "bravo"]);
  });

  describe("pinning", () => {
    it("floats pinned tasks to the top of every sort", () => {
      const pinned = [charlie, alpha, { ...bravo, pinned: true }];
      for (const key of ["smart", "name", "recent", "stale", "created"] as const) {
        expect(names(sortTasks(pinned, key))[0]).toBe("bravo");
      }
    });

    it("keeps the chosen ordering among the pinned ones", () => {
      const pinned = [
        { ...charlie, pinned: true },
        alpha,
        { ...bravo, pinned: true },
      ];
      // Both pinned tasks come first, still in name order between themselves.
      expect(names(sortTasks(pinned, "name"))).toEqual(["bravo", "charlie", "alpha"]);
    });

    it("changes nothing when no task is pinned", () => {
      expect(names(sortTasks(list, "name"))).toEqual(["alpha", "bravo", "charlie"]);
    });
  });
});
