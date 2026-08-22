import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { api, type Activity, type Task } from "@/lib/api";
import { formatDue, formatTime } from "@/lib/time";
import { nextDue } from "@/lib/staleness";
import { ensureContrast } from "@/lib/color";
import { usePrefs } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/Toast";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { useTaskWindows } from "@/components/useTaskWindows";
import { useTheme } from "@/components/ThemeProvider";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// Localised short month names for the month/year picker.
const MONTH_LABELS = Array.from({ length: 12 }, (_, m) =>
  new Date(2000, m, 1).toLocaleDateString(undefined, { month: "short" }),
);

/** A stable local "YYYY-MM-DD" key for grouping things by calendar day. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Calendar shows the current month with a dot on days that had completions and a
 * pip on days a task is next due. It fetches its own month-scoped activity feed,
 * so it stays in sync via the shared ["activity"] query key whenever a
 * completion is logged or removed elsewhere.
 */
export function Calendar({
  tasks,
  className,
  fill = false,
}: {
  tasks: Task[];
  className?: string;
  /** In the side-by-side column: grow to fill, and let the selected-day list
   *  stretch into the space between the grid and the activity chart. */
  fill?: boolean;
}) {
  // First day of the month currently in view (local time).
  const [view, setView] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  // Which way the last month change went, so the grid slides in from that side.
  const [navDir, setNavDir] = useState<"left" | "right">("right");
  // Month/year picker: clicking the title swaps the day grid for a chooser.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const { prefs } = usePrefs();
  const { theme } = useTheme();
  // Backdating: the day detail can log a completion straight onto the day
  // you're looking at, which is the whole reason to click a past date.
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState<number | "">("");
  // The "next up" line borrows the task cards' overdue tint, kept readable
  // against the panel it sits on (see TaskCard for the reasoning).
  const overdueColor = ensureContrast(prefs.taskColorOverdue, theme.colors.card);
  const gridRef = useRef<HTMLDivElement>(null);

  const { openManage } = useTaskWindows();

  // Jump straight to a month/year from the picker; the grid slides in the
  // chronological direction of the jump.
  const goto = (y: number, m: number) => {
    setNavDir(y * 12 + m >= view.getFullYear() * 12 + view.getMonth() ? "right" : "left");
    setSelected(null);
    setPickerOpen(false);
    setView(new Date(y, m, 1));
  };

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // Open a task's Manage window from a calendar entry, if it still exists.
  const openTask = (id: number) => {
    const t = byId.get(id);
    if (t) openManage(t);
  };

  // Log a completion onto the day being viewed. Past days get noon local rather
  // than midnight, so a timezone shift can never slide the entry onto the day
  // before; today keeps the actual current time.
  const queryClient = useQueryClient();
  const toast = useToast();
  const backdate = useMutation({
    mutationFn: ({ taskId, day }: { taskId: number; day: string }) => {
      const [y, m, d] = day.split("-").map(Number);
      const now = new Date();
      const when =
        day === dayKey(now) ? now : new Date(y, m - 1, d, 12, 0, 0, 0);
      return api.completeTask(taskId, { completedAt: when.toISOString() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      setLogOpen(false);
      setLogTaskId("");
      toast("Logged", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // Only active tasks are offered — backdating an archived task would quietly
  // resurrect it in the activity feed without bringing it back into any view.
  const loggable = useMemo(
    () =>
      tasks
        .filter((t) => t.archivedAt == null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    [tasks],
  );

  const year = view.getFullYear();
  const month = view.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  const { data: activity } = useQuery({
    queryKey: ["activity", year, month],
    queryFn: () => api.listActivity(monthStart.toISOString(), monthEnd.toISOString()),
  });

  // Group completions by local day for quick lookup while rendering.
  const byDay = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of activity ?? []) {
      const key = dayKey(new Date(a.completedAt));
      const bucket = map.get(key) ?? [];
      bucket.push(a);
      map.set(key, bucket);
    }
    return map;
  }, [activity]);

  // Map of day -> tasks that are next due that day (within this month).
  const dueByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const d = nextDue(t);
      if (d && d >= monthStart && d < monthEnd) {
        const key = dayKey(d);
        const bucket = map.get(key) ?? [];
        bucket.push(t);
        map.set(key, bucket);
      }
    }
    return map;
  }, [tasks, monthStart, monthEnd]);

  // The single soonest due task across all tasks (surfaces overdue first).
  const nextUp = useMemo(() => {
    let best: { task: Task; due: Date } | null = null;
    for (const t of tasks) {
      const d = nextDue(t);
      if (d && (!best || d < best.due)) best = { task: t, due: d };
    }
    return best;
  }, [tasks]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const todayKey = dayKey(new Date());

  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const monthLabel = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const selectedActivities = selected ? (byDay.get(selected) ?? []) : [];
  const selectedDue = selected ? (dueByDay.get(selected) ?? []) : [];
  // A past or present day can always be opened, even with nothing on it, so
  // there's somewhere to record "I actually did this on Tuesday". Future days
  // stay closed unless something is genuinely scheduled for them — you can't
  // have done a thing yet.
  const canBackdate = selected != null && selected <= dayKey(new Date());
  const hasDetail = selectedActivities.length > 0 || selectedDue.length > 0 || canBackdate;

  // Keep the selected-day detail mounted (as a snapshot) through its close
  // transition, so it animates *out* as well as in — collapsing unmounts it
  // instantly otherwise, which is the "no closing animation" the day list had.
  const [detail, setDetail] = useState<
    { acts: Activity[]; dues: Task[]; day: string; canBackdate: boolean } | null
  >(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (selected && hasDetail) {
      setDetail({
        acts: byDay.get(selected) ?? [],
        dues: dueByDay.get(selected) ?? [],
        day: selected,
        canBackdate,
      });
      const raf = requestAnimationFrame(() => setOpen(true)); // mount closed → open
      return () => cancelAnimationFrame(raf);
    }
    setOpen(false);
    const id = setTimeout(() => setDetail(null), 220);
    return () => clearTimeout(id);
  }, [selected, hasDetail, byDay, dueByDay, canBackdate]);

  // Close the backdating row whenever the selected day changes, so it never
  // carries a half-finished choice from one day to another.
  useEffect(() => {
    setLogOpen(false);
    setLogTaskId("");
  }, [selected]);

  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4",
        // Fill mode: become a flex column, and grow only while a day is open so
        // the card doesn't stretch with empty space when nothing is selected.
        fill && "flex flex-col",
        fill && open && "min-h-0 flex-1",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        {/* The title is a button: clicking it swaps the day grid for a
            month/year picker so any date is a couple of taps away. */}
        <button
          type="button"
          onClick={() => {
            setPickerYear(year);
            setPickerOpen((o) => !o);
          }}
          aria-expanded={pickerOpen}
          title="Pick a month and year"
          className="group flex items-center gap-1 rounded text-sm font-semibold transition-colors hover:text-primary"
        >
          {/* Keyed by the month so the label fades in alongside the sliding grid. */}
          <span
            key={monthLabel}
            className={cn(prefs.animViews && "animate-in fade-in-0 duration-300")}
          >
            {monthLabel}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-hover:text-primary",
              pickerOpen && "rotate-180",
            )}
          />
        </button>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Previous month"
            onClick={() => {
              setSelected(null);
              setNavDir("left");
              setPickerOpen(false);
              setView(new Date(year, month - 1, 1));
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Next month"
            onClick={() => {
              setSelected(null);
              setNavDir("right");
              setPickerOpen(false);
              setView(new Date(year, month + 1, 1));
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {pickerOpen && (
        <div className={cn("space-y-2", prefs.animViews && "animate-in fade-in-0 zoom-in-95 duration-200")}>
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Previous year"
              onClick={() => setPickerYear((y) => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{pickerYear}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Next year"
              onClick={() => setPickerYear((y) => y + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTH_LABELS.map((label, m) => {
              const now = new Date();
              const isViewed = pickerYear === year && m === month;
              const isThisMonth = pickerYear === now.getFullYear() && m === now.getMonth();
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => goto(pickerYear, m)}
                  className={cn(
                    "rounded-md py-2 text-xs transition-colors",
                    isViewed
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    isThisMonth && !isViewed && "ring-1 ring-primary/40",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => {
              const n = new Date();
              goto(n.getFullYear(), n.getMonth());
            }}
            className="w-full rounded-md py-1 text-center text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            Jump to today
          </button>
        </div>
      )}

      {!pickerOpen && (
      <div className="grid select-none grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>
      )}

      {/* Keyed by month so navigating slides the new grid in from the side you
          moved towards (and remounting keeps day cells from carrying state over).
          relative so the selected-day bubble can glide between cells. */}
      {!pickerOpen && (
      <div
        key={`${year}-${month}`}
        ref={gridRef}
        className={cn(
          "relative grid select-none grid-cols-7 gap-1",
          prefs.animViews && [
            "animate-in fade-in-0 duration-300",
            navDir === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4",
          ],
        )}
      >
        <SlidingHighlight containerRef={gridRef} activeKey={selected} className="rounded-md bg-accent" />
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const cellDate = new Date(year, month, day);
          const key = dayKey(cellDate);
          const completions = byDay.get(key) ?? [];
          const dues = dueByDay.get(key) ?? [];
          const isToday = key === todayKey;
          const isSelected = key === selected;

          return (
            <button
              key={key}
              data-slide-key={key}
              onClick={() => setSelected(isSelected ? null : key)}
              className={cn(
                // The selected background is the sliding bubble behind the cells
                // (see SlidingHighlight above), not a per-cell class.
                "relative flex aspect-square flex-col items-center justify-center rounded-md text-xs transition-colors",
                !isSelected && "hover:bg-accent",
                isToday && "ring-1 ring-primary",
              )}
            >
              <span className={cn(isToday && "font-semibold text-primary")}>{day}</span>
              {/* completion dots (max 3) */}
              {completions.length > 0 && (
                <span className="mt-0.5 flex gap-0.5">
                  {Array.from({ length: Math.min(3, completions.length) }).map((_, j) => (
                    <span key={j} className="h-1 w-1 rounded-full bg-emerald-500" />
                  ))}
                </span>
              )}
              {/* due pip in the corner */}
              {dues.length > 0 && (
                <span
                  className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500"
                  title={`${dues.length} due`}
                />
              )}
            </button>
          );
        })}
      </div>
      )}

      {/* Next up across all tasks */}
      <div className="mt-3 border-t pt-3 text-xs">
        {nextUp ? (
          <button
            type="button"
            onClick={() => openTask(nextUp.task.id)}
            className="w-full rounded-md text-left text-muted-foreground transition-colors hover:text-foreground"
            title="Open task"
          >
            <span className="font-medium text-foreground">Next up:</span> {nextUp.task.name}{" "}
            {/* Matches the task cards: the user's own overdue colour, nudged to
                stay readable on the panel rather than a fixed pale rose. */}
            <span style={formatDue(nextUp.due).overdue ? { color: overdueColor } : undefined}>
              ({formatDue(nextUp.due).text})
            </span>
          </button>
        ) : (
          <p className="text-muted-foreground">No routines scheduled yet.</p>
        )}
      </div>

      {/* Selected-day detail: capped height + scroll so the calendar and the
          activity chart stay on screen; animates both in and out via a
          max-height/opacity transition on the lingering snapshot. */}
      {detail && (
        <div
          className={cn(
            "space-y-1.5 overflow-y-auto border-t text-xs",
            fill
              ? // Stretch to fill the remaining column height (down to the activity chart).
                open
                ? "mt-3 min-h-0 flex-1 pt-3 opacity-100"
                : "max-h-0 overflow-hidden opacity-0"
              : // Stacked layout: animate a capped height open/closed.
                cn(
                  "transition-[max-height,opacity,margin,padding] duration-200 ease-out",
                  open ? "mt-3 max-h-40 pt-3 opacity-100" : "mt-0 max-h-0 pt-0 opacity-0",
                ),
          )}
        >
          {detail.acts.map((a) => (
            <button
              key={a.completionId}
              type="button"
              onClick={() => openTask(a.taskId)}
              className="flex w-full gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent"
              title="Open task"
            >
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{a.taskName}</span>
                  <span className="text-muted-foreground">
                    {formatTime(new Date(a.completedAt))}
                  </span>
                </div>
                {a.note && (
                  <p className="mt-0.5 break-words text-muted-foreground">{a.note}</p>
                )}
              </div>
            </button>
          ))}
          {detail.dues.map((t) => (
            <button
              key={`due-${t.id}`}
              type="button"
              onClick={() => openTask(t.id)}
              className="flex w-full items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-accent"
              title="Open task"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span className="font-medium">{t.name}</span>
              <span className="text-muted-foreground">due</span>
            </button>
          ))}

          {/* Backdating. Collapsed to a single line until asked for, so the day
              list stays a list; the control is full-width and comfortably tall
              rather than a tiny inline affordance, which matters on a phone. */}
          {detail.canBackdate && loggable.length > 0 && (
            <div className="pt-0.5">
              {logOpen ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={logTaskId}
                    autoFocus
                    onChange={(e) => setLogTaskId(e.target.value ? Number(e.target.value) : "")}
                    aria-label="Task to log"
                    className="h-8 min-w-0 flex-1 basis-32 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="" className="bg-background">
                      Pick a task…
                    </option>
                    {loggable.map((t) => (
                      <option key={t.id} value={t.id} className="bg-background">
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    className="h-8"
                    disabled={logTaskId === "" || backdate.isPending}
                    onClick={() => backdate.mutate({ taskId: Number(logTaskId), day: detail.day })}
                  >
                    {backdate.isPending ? "Logging…" : "Log"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setLogOpen(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setLogOpen(true)}
                  className="flex w-full items-center gap-1.5 rounded-md p-1.5 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  Log a task on this day
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
