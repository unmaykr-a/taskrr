import type { Task } from "./api";

/** Distinct, alphabetically-sorted folder names across the given tasks. */
export function folderNames(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of tasks) if (t.folder) set.add(t.folder);
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
