import { describe, expect, it } from "vitest";

import type { TaskMember } from "@/lib/api";
import { isMyTurn, nextUp, rotationOrder } from "@/lib/rotation";

const members = (...entries: [string, TaskMember["status"]][]): TaskMember[] =>
  entries.map(([username, status], i) => ({ userId: i + 1, username, status }));

describe("rotationOrder", () => {
  it("keeps the owner and everyone who has accepted, in order", () => {
    const list = members(["alice", "owner"], ["bob", "accepted"], ["carol", "accepted"]);
    expect(rotationOrder(list)).toEqual(["alice", "bob", "carol"]);
  });

  it("leaves out anyone who hasn't accepted yet", () => {
    // A pending invitee has no access, so they can't have a turn.
    const list = members(["alice", "owner"], ["bob", "pending"], ["carol", "accepted"]);
    expect(rotationOrder(list)).toEqual(["alice", "carol"]);
  });

  it("handles missing members", () => {
    expect(rotationOrder(undefined)).toEqual([]);
    expect(rotationOrder([])).toEqual([]);
  });
});

describe("nextUp", () => {
  const order = ["alice", "bob", "carol"];

  it("starts at the top when nobody has logged yet", () => {
    expect(nextUp(order, null)).toBe("alice");
  });

  it("moves to the next member after whoever logged last", () => {
    expect(nextUp(order, "alice")).toBe("bob");
    expect(nextUp(order, "bob")).toBe("carol");
  });

  it("wraps around at the end", () => {
    expect(nextUp(order, "carol")).toBe("alice");
  });

  it("says nothing for a rota of one", () => {
    // "Your turn" every single time is noise, not information.
    expect(nextUp(["alice"], null)).toBeNull();
    expect(nextUp(["alice"], "alice")).toBeNull();
    expect(nextUp([], null)).toBeNull();
  });

  it("falls back to the top when the last logger has since left", () => {
    // Their completion still exists, but they have no position to advance from,
    // so the rota restarts rather than guessing where they used to be.
    expect(nextUp(order, "dave")).toBe("alice");
  });

  it("is stable when called repeatedly without a new completion", () => {
    expect(nextUp(order, "bob")).toBe(nextUp(order, "bob"));
  });
});

describe("isMyTurn", () => {
  const order = ["alice", "bob"];

  it("is true only for the person actually up next", () => {
    expect(isMyTurn(order, "alice", "bob")).toBe(true);
    expect(isMyTurn(order, "alice", "alice")).toBe(false);
  });

  it("is false when the viewer is unknown", () => {
    expect(isMyTurn(order, "alice", undefined)).toBe(false);
  });

  it("is false when there is no rota to speak of", () => {
    expect(isMyTurn(["alice"], null, "alice")).toBe(false);
  });
});
