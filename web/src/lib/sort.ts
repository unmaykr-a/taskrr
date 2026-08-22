// sort.ts — how the task list is ordered. Kept here (like filters.ts) so the
// ordering policy lives in one tunable place next to the UI.

import type { Task } from "./api";

export type SortKey = "smart" | "name" | "recent" | "stale" | "created";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "smart", label: "Recommended" },
  { key: "name", label: "Name (A-Z)" },
  { key: "recent", label: "Recently done" },
  { key: "stale", label: "Least recently done" },
  { key: "created", label: "Newest" },
];

function lastDone(t: Task): number {
  return t.lastCompletedAt ? Date.parse(t.lastCompletedAt) : 0;
}

/**
 * Return a new array ordered by the chosen key. "smart" keeps the server order
 * (most actionable first), so it is a stable copy with no reordering.
 *
 * Pinned tasks float to the top of whatever ordering was chosen. That is the
 * point of pinning — it should survive switching between "Recommended" and
 * "Name (A-Z)" — so it is applied last, over the top of the sort, rather than
 * being one more sort key.
 */
export function sortTasks(tasks: Task[], key: SortKey): Task[] {
  const out = [...tasks];
  switch (key) {
    case "name":
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      break;
    case "recent":
      out.sort((a, b) => lastDone(b) - lastDone(a));
      break;
    case "stale":
      out.sort((a, b) => lastDone(a) - lastDone(b));
      break;
    case "created":
      out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      break;
    case "smart":
    default:
      break;
  }
  // Stable partition, so pinned tasks keep the relative order the sort gave
  // them instead of being shuffled among themselves.
  return [...out.filter((t) => t.pinned), ...out.filter((t) => !t.pinned)];
}
