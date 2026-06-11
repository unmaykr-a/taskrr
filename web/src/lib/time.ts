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

// --- absolute date/time formatting -------------------------------------------
// The Preferences "Time & date" section can override the system defaults; the
// PrefsProvider pushes its choices in here so every caller picks the format up
// automatically.

export type DateOrder = "auto" | "dmy" | "mdy" | "ymd";

let dateOrder: DateOrder = "auto";
let hour12Override: boolean | undefined; // undefined = follow the locale

/** setTimeFormat applies the user's date/clock preferences (see PrefsProvider). */
export function setTimeFormat(opts: { dateOrder: DateOrder; hour12?: boolean }) {
  dateOrder = opts.dateOrder;
  hour12Override = opts.hour12;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** formatTime renders just the clock time, honouring the 12/24h preference. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(hour12Override !== undefined ? { hour12: hour12Override } : {}),
  });
}

/** formatDate renders just the date, honouring the date-order preference. */
export function formatDate(d: Date): string {
  switch (dateOrder) {
    case "dmy":
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    case "mdy":
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    case "ymd":
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    default:
      return d.toLocaleDateString(undefined, { dateStyle: "medium" });
  }
}

/** formatDateTime renders an absolute date and time per the user's preferences. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(d)}, ${formatTime(d)}`;
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
