// filters.ts — the small set of "views" the sidebar offers over the task list.
// Kept separate (and built on top of staleness.ts) so adding a view is a
// one-line change here rather than spread across components.

import type { Task } from "./api";
import { taskStaleness } from "./staleness";

export type Filter =
  | "all"
  | "due-soon"
  | "overdue"
  | "none"
  | "archived"
  | "shared"
  | "requests";

export const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All tasks" },
  { key: "due-soon", label: "Due soon" },
  { key: "overdue", label: "Overdue" },
  { key: "none", label: "Never done" },
  { key: "archived", label: "Archived" },
];

/** Extra views shown only when task sharing is enabled. "shared" groups tasks
 *  with collaborators; "requests" is not a task filter — the app renders its own
 *  list of incoming invites — so callers gate it specially. */
export const SHARE_FILTERS: { key: Filter; label: string }[] = [
  { key: "shared", label: "Shared" },
  { key: "requests", label: "Requests" },
];

/**
 * Whether a task belongs in the given view at the given moment. Archived tasks
 * only appear in the "Archived" view; every other view is active-tasks-only.
 * "requests" never matches a task here (the app renders incoming invites for it).
 */
export function matchesFilter(task: Task, filter: Filter, now?: number): boolean {
  if (filter === "requests") return false;
  if (filter === "archived") return task.archivedAt != null;
  if (task.archivedAt != null) return false;
  if (filter === "all") return true;
  if (filter === "shared") return task.shared;
  return taskStaleness(task, now) === filter;
}
