import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The ranges the chart offers. Kept short so the row fits a 340px side panel. */
export const ACTIVITY_RANGES = [7, 30, 90, 365] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

const RANGE_LABELS: Record<ActivityRange, string> = {
  7: "7d",
  30: "30d",
  90: "90d",
  365: "1y",
};

/**
 * Bars are one day each up to a point. Past that a year's worth would be
 * sub-pixel slivers in a narrow panel, so days are grouped into weeks — the
 * shape of the year stays readable and the bar count stays bounded (~52).
 */
function bucketDays(days: number): number {
  return days > 120 ? 7 : 1;
}

/**
 * ActivityChart is a compact bar chart of completions over the last `days`
 * days — a quick sense of how much you've been logging. It fetches its own
 * range from the shared activity feed under an ["activity", …] key, so it
 * refreshes automatically whenever a completion is logged or removed.
 *
 * The range is a per-user preference rather than a prop default, so the choice
 * follows the account across devices like every other layout setting.
 */
export function ActivityChart({
  className,
}: {
  /** Extra classes for positioning (e.g. anchoring to the bottom of a column). */
  className?: string;
}) {
  const { prefs, setPrefs } = usePrefs();
  const rangeRef = useRef<HTMLDivElement>(null);
  const days = prefs.activityDays;
  const bucket = bucketDays(days);

  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1); // start of tomorrow, exclusive
    return { start, end };
  }, [days]);

  const { data } = useQuery({
    queryKey: ["activity", "chart", days, dayKey(range.start)],
    queryFn: () => api.listActivity(range.start.toISOString(), range.end.toISOString()),
  });

  const bars = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data ?? []) {
      const k = dayKey(new Date(a.completedAt));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    // Walk the window in bucket-sized steps, summing the days in each step. The
    // last bucket is clamped to today so a partial week isn't counted as future.
    const out: { key: string; date: Date; end: Date; count: number }[] = [];
    for (let offset = 0; offset < days; offset += bucket) {
      const d = new Date(range.start);
      d.setDate(d.getDate() + offset);
      let count = 0;
      const span = Math.min(bucket, days - offset);
      for (let i = 0; i < span; i++) {
        const day = new Date(d);
        day.setDate(day.getDate() + i);
        count += counts.get(dayKey(day)) ?? 0;
      }
      const end = new Date(d);
      end.setDate(end.getDate() + span - 1);
      out.push({ key: dayKey(d), date: d, end, count });
    }
    return out;
  }, [data, days, bucket, range.start]);

  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);
  const active = bars.filter((b) => b.count > 0).length;
  const avg = active ? total / active : 0;
  // Square-root scale: a single import-day spike of 50 would otherwise flatten
  // every normal day into an unreadable sliver. sqrt keeps the spike tallest
  // while ordinary days stay visible (1-of-50 still renders at ~14% height).
  const scaled = (count: number) => Math.sqrt(count / max) * 100;
  const todayKey = dayKey(new Date());
  const unit = bucket === 1 ? "day" : "week";
  // Tight ranges can afford a gap between bars; a year's worth cannot.
  const gapClass = bars.length > 60 ? "gap-px" : "gap-[2px]";

  const label = (b: { date: Date; end: Date; count: number }) => {
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const when = bucket === 1 ? fmt(b.date) : `${fmt(b.date)} – ${fmt(b.end)}`;
    return `${when}: ${b.count} ${b.count === 1 ? "completion" : "completions"}`;
  };

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="truncate text-xs text-muted-foreground">
          {total} in {RANGE_LABELS[days as ActivityRange] ?? `${days}d`} · peak {max}/{unit}
        </span>
      </div>

      {/* Range picker. Small targets are fine with a mouse but not with a
          thumb, so the row is comfortably tappable and spans the full width. */}
      <div
        ref={rangeRef}
        className="relative mb-3 grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-1 text-xs"
      >
        <SlidingHighlight containerRef={rangeRef} activeKey={String(days)} className="rounded-md bg-primary" />
        {ACTIVITY_RANGES.map((r) => (
          <button
            key={r}
            data-slide-key={String(r)}
            type="button"
            onClick={() => setPrefs({ activityDays: r })}
            aria-pressed={days === r}
            className={cn(
              "relative rounded-md py-1.5 transition-colors duration-200",
              days === r ? "font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>

      <div className="flex gap-1.5">
        {/* y-axis: peak at top, 0 at bottom. The mid label shows the value at
            half height (max/4 under the sqrt scale) so the compression is
            honest rather than hidden. */}
        <div
          className="flex h-20 flex-col justify-between py-px text-right text-[10px] leading-none tabular-nums text-muted-foreground"
          title="Bar heights use a square-root scale, so one unusually busy period doesn't flatten the rest"
        >
          <span>{max}</span>
          {max >= 8 && <span className="opacity-70">{Math.round(max / 4)}</span>}
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative">
            {/* gridline at the peak value, so a full-height bar reads as `max`. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/50" />
            {/* dashed marker at the average per active bucket */}
            {active > 0 && max > 1 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/40"
                style={{ bottom: `${scaled(avg)}%` }}
                title={`Average ${avg.toFixed(1)}/${unit} on active ${unit}s`}
              />
            )}
            <div className={cn("flex h-20 items-end", gapClass)}>
              {bars.map((b) => {
                const isNow = bucket === 1 ? b.key === todayKey : new Date() <= b.end;
                return (
                  <div key={b.key} className="group flex h-full flex-1 items-end" title={label(b)}>
                    {/* Eased height/opacity so a new log grows its bar smoothly;
                        hovering a column brightens its bar. */}
                    <div
                      className={cn(
                        "w-full rounded-t bg-primary transition-[height,opacity] duration-500 ease-out group-hover:brightness-125",
                        isNow && "ring-1 ring-primary/60",
                      )}
                      style={{
                        height: b.count ? `${Math.max(6, scaled(b.count))}%` : "2px",
                        opacity: b.count ? (isNow ? 1 : 0.45 + 0.55 * (b.count / max)) : 0.15,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="shrink-0">
              {bars[0]?.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
            <span className="truncate">
              {active} active {active === 1 ? unit : `${unit}s`}
              {active > 0 && ` · avg ${avg.toFixed(avg >= 10 ? 0 : 1)}`}
            </span>
            <span className="shrink-0">today</span>
          </div>
        </div>
      </div>
    </div>
  );
}
