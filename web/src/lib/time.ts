// Human-friendly time helpers for the "time since last done", cadence, and
// "next due" displays. Pure functions, easy to test and reuse.

/** timeSince renders an ISO timestamp as a relative phrase like "3 days ago". */
export function timeSince(iso: string | null): string {
  if (!iso) return "Never done";

  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));

  if (sec < 45) return "Just now";

  const units: [limit: number, secs: number, name: string][] = [
    [60, 1, "second"],
    [60, 60, "minute"],
    [24, 3600, "hour"],
    [7, 86400, "day"],
    [4.348, 604800, "week"],
    [12, 2629800, "month"],
    [Number.POSITIVE_INFINITY, 31557600, "year"],
  ];

  for (const [limit, secs, name] of units) {
    const value = Math.floor(sec / secs);
    if (value < limit) {
      const v = Math.max(1, value);
      return `${v} ${name}${v === 1 ? "" : "s"} ago`;
    }
  }
  return "a long time ago";
}

/** daysSince returns the number of whole days since an ISO timestamp, or null. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/** formatDateTime renders an absolute, locale-aware date and time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * formatInterval turns a cadence in seconds into a clean phrase like
 * "7 days" or "12 hours". It assumes the value is a whole multiple of a sensible
 * unit (which the IntervalField always produces).
 */
export function formatInterval(seconds: number): string {
  const units: [secs: number, name: string][] = [
    [604_800, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, name] of units) {
    if (seconds % secs === 0) {
      const v = seconds / secs;
      return `${v} ${name}${v === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} seconds`;
}

/** humanizeDuration renders an absolute millisecond span like "3 days". */
export function humanizeDuration(ms: number): string {
  const sec = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const units: [secs: number, name: string][] = [
    [604_800, "week"],
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, name] of units) {
    const v = Math.floor(sec / secs);
    if (v >= 1) return `${v} ${name}${v === 1 ? "" : "s"}`;
  }
  return "moments";
}

/** formatDue describes a due date relative to now ("due in 3 days" / "overdue by …"). */
export function formatDue(
  due: Date,
  now: number = Date.now(),
): { text: string; overdue: boolean } {
  const diff = due.getTime() - now;
  // Within an hour either side reads as "due now".
  if (Math.abs(diff) < 3_600_000) return { text: "due now", overdue: diff < 0 };
  return diff >= 0
    ? { text: `due in ${humanizeDuration(diff)}`, overdue: false }
    : { text: `overdue by ${humanizeDuration(diff)}`, overdue: true };
}
