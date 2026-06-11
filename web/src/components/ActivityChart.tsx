import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * ActivityChart is a compact bar chart of completions per day over the last
 * `days` days — a quick sense of how much you've been logging. It fetches its
 * own range from the shared activity feed under an ["activity", …] key, so it
 * refreshes automatically whenever a completion is logged or removed.
 */
export function ActivityChart({
  days = 30,
  className,
}: {
  days?: number;
  /** Extra classes for positioning (e.g. anchoring to the bottom of a column). */
  className?: string;
}) {
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
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(range.start);
      d.setDate(d.getDate() + i);
      return { key: dayKey(d), date: d, count: counts.get(dayKey(d)) ?? 0 };
    });
  }, [data, days, range.start]);

  const max = Math.max(1, ...bars.map((b) => b.count));
  const total = bars.reduce((s, b) => s + b.count, 0);
  const active = bars.filter((b) => b.count > 0).length;
  const avg = active ? total / active : 0;
  // Square-root scale: a single import-day spike of 50 would otherwise flatten
  // every normal day into an unreadable sliver. sqrt keeps the spike tallest
  // while ordinary days stay visible (1-of-50 still renders at ~14% height).
  const scaled = (count: number) => Math.sqrt(count / max) * 100;
  const todayKey = dayKey(new Date());

  return (
    <div className={cn("rounded-xl border bg-card p-4", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="text-xs text-muted-foreground">
          {total} in {days}d · peak {max}/day
        </span>
      </div>
      <div className="flex gap-1.5">
        {/* y-axis: peak at top, 0 at bottom. The mid label shows the value at
            half height (max/4 under the sqrt scale) so the compression is
            honest rather than hidden. */}
        <div
          className="flex h-20 flex-col justify-between py-px text-right text-[10px] leading-none tabular-nums text-muted-foreground"
          title="Bar heights use a square-root scale, so one unusually busy day doesn't flatten the rest"
        >
          <span>{max}</span>
          {max >= 8 && <span className="opacity-70">{Math.round(max / 4)}</span>}
          <span>0</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative">
            {/* gridline at the peak value, so a full-height bar reads as `max`. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/50" />
            {/* dashed marker at the average per active day */}
            {active > 0 && max > 1 && (
              <div
                className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/40"
                style={{ bottom: `${scaled(avg)}%` }}
                title={`Average ${avg.toFixed(1)}/day on active days`}
              />
            )}
            <div className="flex h-20 items-end gap-[2px]">
              {bars.map((b) => {
                const isToday = b.key === todayKey;
                return (
                  <div
                    key={b.key}
                    className="group flex h-full flex-1 items-end"
                    title={`${b.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${b.count} ${b.count === 1 ? "completion" : "completions"}`}
                  >
                    {/* Eased height/opacity so a new log grows its bar smoothly;
                        hovering a column brightens its bar. */}
                    <div
                      className={cn(
                        "w-full rounded-t bg-primary transition-[height,opacity] duration-500 ease-out group-hover:brightness-125",
                        isToday && "ring-1 ring-primary/60",
                      )}
                      style={{
                        height: b.count ? `${Math.max(6, scaled(b.count))}%` : "2px",
                        opacity: b.count ? (isToday ? 1 : 0.45 + 0.55 * (b.count / max)) : 0.15,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>{bars[0]?.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <span>
              {active} active {active === 1 ? "day" : "days"}
              {active > 0 && ` · avg ${avg.toFixed(avg >= 10 ? 0 : 1)}/day`}
            </span>
            <span>today</span>
          </div>
        </div>
      </div>
    </div>
  );
}
