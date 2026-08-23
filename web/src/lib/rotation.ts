// rotation.ts — "whose turn is it" on a shared task.
//
// Deliberately derived rather than stored. Given the member order and who
// logged last, the next turn is simply the next member along. Nothing is
// persisted beyond the opt-in flag, so there is no pointer to drift when
// somebody joins, leaves, or logs out of turn: the rota is a reading of the
// history, not a second source of truth about it.
//
// Pure and React-free, so the policy is testable in one place (rotation.test.ts).

import type { TaskMember } from "./api";

/** Members eligible to take a turn: the owner plus anyone who has accepted. */
export function rotationOrder(members: TaskMember[] | undefined): string[] {
  if (!members) return [];
  return members
    .filter((m) => m.status === "owner" || m.status === "accepted")
    .map((m) => m.username);
}

/**
 * Whose turn it is now.
 *
 * `lastCompletedBy` is the username of whoever logged the most recent
 * completion. The next turn belongs to whoever follows them in the order,
 * wrapping around at the end.
 *
 * Returns null when there is nobody to name — no members, or a rota of one,
 * where "your turn" every time is noise rather than information.
 */
export function nextUp(order: string[], lastCompletedBy: string | null): string | null {
  if (order.length < 2) return null;
  if (!lastCompletedBy) return order[0]; // nobody has gone yet: start at the top

  const at = order.indexOf(lastCompletedBy);
  // Someone who has since left the task can still own the last completion. Their
  // turn can't advance, so fall back to the top rather than guessing a position.
  if (at === -1) return order[0];
  return order[(at + 1) % order.length];
}

/** Whether it is this viewer's turn — for the "your turn" emphasis on a card. */
export function isMyTurn(order: string[], lastCompletedBy: string | null, me: string | undefined): boolean {
  if (!me) return false;
  return nextUp(order, lastCompletedBy) === me;
}
