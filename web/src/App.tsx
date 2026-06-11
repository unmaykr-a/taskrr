import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ListTodo, Menu, Plus } from "lucide-react";

import { api } from "@/lib/api";
import { type Filter, FILTERS, matchesFilter } from "@/lib/filters";
import { taskStaleness } from "@/lib/staleness";
import { usePrefs } from "@/lib/prefs";
import { useFlip } from "@/lib/useFlip";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/Sidebar";
import { TaskCard } from "@/components/TaskCard";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { Calendar } from "@/components/Calendar";
import { ActivityChart } from "@/components/ActivityChart";
import { BulkBar } from "@/components/BulkBar";
import { PreferencesSync } from "@/components/PreferencesSync";

// Human-readable result of an OIDC account-link attempt (see the callback in
// internal/api/oidc.go, which redirects back here with ?oidcLink=...).
const OIDC_LINK_MESSAGES: Record<string, string> = {
  linked: "Single sign-on connected to your account.",
  conflict: "That single sign-on identity is already linked to another account.",
  error: "Could not connect single sign-on. Please try again.",
};

export default function App() {
  const now = useNow(); // ticking clock so staleness/counts refresh over time
  const { prefs } = usePrefs();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");

  // After returning from an OIDC link attempt, surface the outcome and refresh
  // the cached user so the Settings UI reflects the new link state, then strip
  // the query param so a reload doesn't repeat the toast.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("oidcLink");
    if (!result) return;
    const message = OIDC_LINK_MESSAGES[result] ?? OIDC_LINK_MESSAGES.error;
    if (result === "linked") queryClient.invalidateQueries({ queryKey: ["me"] });
    window.history.replaceState({}, "", window.location.pathname);
    window.alert(message);
  }, [queryClient]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  const clearSelection = () => {
    setSelected(new Set());
    setSelectMode(false);
  };
  const toggleSelected = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Layout: a landscape phone (short viewport) behaves like mobile for the nav
  // (keep the hamburger drawer) but uses the desktop side-by-side, independently
  // scrolling layout so the task list scrolls while the calendar stays put.
  const wide = useMediaQuery("(min-width: 1280px)");
  const phoneLandscape = useMediaQuery("(orientation: landscape) and (max-height: 600px)");
  const compact = useMediaQuery("(max-width: 767px)") || phoneLandscape; // drawer nav
  const sideBySide = wide || phoneLandscape; // calendar as a fixed right panel

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: api.listTasks,
  });
  const tasks = data ?? [];

  // Animate task-grid layout changes: when a quick log / filter change / new
  // task reorders the grid, surviving cards glide to their new spot and
  // appearing ones fade in (see useFlip). Cards opt in via data-flip-key.
  const gridRef = useRef<HTMLDivElement>(null);
  useFlip(gridRef, prefs.animGrid);
  const views = prefs.animViews; // gate for the decorative view transitions

  // Counts per sidebar view (recomputed as time passes via `now`). Archived
  // tasks are excluded from the active views and counted on their own.
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, "due-soon": 0, overdue: 0, none: 0, archived: 0 };
    for (const t of tasks) {
      if (t.archivedAt != null) {
        c.archived += 1;
        continue;
      }
      c.all += 1;
      const s = taskStaleness(t, now);
      if (s === "due-soon" || s === "overdue" || s === "none") c[s] += 1;
    }
    return c;
  }, [tasks, now]);

  const visible = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filter, now)),
    [tasks, filter, now],
  );

  const filterLabel = FILTERS.find((f) => f.key === filter)?.label ?? "Tasks";
  const archivedView = filter === "archived";
  // Only act on selected tasks that are actually in the current view.
  const selectedIds = useMemo(
    () => visible.filter((t) => selected.has(t.id)).map((t) => t.id),
    [visible, selected],
  );

  return (
    <>
      {/* Load/save this account's theme + layout prefs server-side. */}
      <PreferencesSync />
      <div className={cn("relative z-10 flex", sideBySide ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}>
        {/* Mobile/landscape drawer scrim */}
        {compact && sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 animate-in fade-in-0 duration-200"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar: static column on large screens, off-canvas drawer when compact. */}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 transition-transform duration-300 ease-in-out will-change-transform",
            compact
              ? sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full"
              : "static z-auto translate-x-0",
          )}
        >
          <Sidebar
            filter={filter}
            onFilterChange={(f) => {
              setFilter(f);
              setSidebarOpen(false);
              setSelected(new Set());
            }}
            counts={counts}
            onClose={() => setSidebarOpen(false)}
          />
        </aside>

        {/* Main column */}
        <div className={cn("flex min-w-0 flex-1 flex-col", sideBySide && "h-full overflow-hidden")}>
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
            {compact && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu />
              </Button>
            )}
            {/* Keyed by filter so switching views crossfades the heading in. */}
            <div
              key={filter}
              className={cn("min-w-0", views && "animate-in fade-in-0 slide-in-from-left-2 duration-300")}
            >
              <h2 className="truncate text-sm font-semibold">{filterLabel}</h2>
              <p className="text-xs text-muted-foreground">
                {visible.length} {visible.length === 1 ? "task" : "tasks"}
              </p>
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Multi-select toggle (hidden when there's nothing to select). */}
              {visible.length > 0 && (
                <Button
                  variant={selectMode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setSelectMode((m) => !m);
                    setSelected(new Set());
                  }}
                >
                  <CheckSquare /> {selectMode ? "Done" : "Select"}
                </Button>
              )}
              {/* Compact: add button in the header unless the user prefers a bottom FAB. */}
              {compact && prefs.addButton === "top" && <CreateTaskDialog />}
            </div>
          </header>

          <main
            className={cn(
              "flex flex-1 flex-col gap-6 p-4",
              sideBySide && "min-h-0 flex-row gap-4 overflow-hidden p-0",
            )}
          >
            <div className={cn("min-w-0 flex-1", sideBySide && "overflow-y-auto p-4")}>
              {isLoading && <GridSkeleton stagger={views} />}

              {isError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  Failed to load tasks: {(error as Error).message}
                </div>
              )}

              {!isLoading && !isError && visible.length === 0 && (
                <EmptyState filter={filter} animate={views} />
              )}

              {visible.length > 0 && (
                <div
                  ref={gridRef}
                  className={cn(
                    "grid gap-4",
                    // A fixed column count is for roomy screens only — on phones /
                    // landscape phones fall back to the responsive 1→2→3 grid so
                    // cards don't get crushed into unreadable slivers.
                    (prefs.taskColumns === 0 || compact) && "grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3",
                  )}
                  style={
                    prefs.taskColumns > 0 && !compact
                      ? { gridTemplateColumns: `repeat(${prefs.taskColumns}, minmax(0, 1fr))` }
                      : undefined
                  }
                >
                  {visible.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      selectable={selectMode}
                      selected={selected.has(task.id)}
                      onToggleSelected={() => toggleSelected(task.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right-side panels (stack below when not side-by-side; each toggle-able).
                Side-by-side: a full-height flex column with the calendar up top and
                the activity chart at its natural size pinned to the bottom (mt-auto).
                When the chart is hidden, the calendar's day list gets the extra room. */}
            {(prefs.showCalendar || prefs.showActivity) && (
              <div
                className={cn(
                  sideBySide ? "flex h-full w-[340px] shrink-0 flex-col gap-4 overflow-hidden p-4" : "space-y-4",
                )}
              >
                {prefs.showCalendar && (
                  <Calendar tasks={tasks} className={cn(sideBySide && "shrink-0")} fill={sideBySide} />
                )}
                {prefs.showActivity && <ActivityChart className={cn(sideBySide && "mt-auto")} />}
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Bulk-action bar while tasks are selected. */}
      {selectMode && selectedIds.length > 0 && (
        <BulkBar ids={selectedIds} archivedView={archivedView} onClear={clearSelection} />
      )}

      {/* Optional bottom-right floating "add" button on compact screens. */}
      {compact && prefs.addButton === "bottom" && !selectMode && (
        <CreateTaskDialog
          trigger={
            <Button
              size="icon"
              aria-label="New task"
              className="fixed bottom-4 right-4 z-[46] h-14 w-14 rounded-full shadow-xl"
            >
              <Plus className="h-6 w-6" />
            </Button>
          }
        />
      )}
    </>
  );
}

function EmptyState({ filter, animate = true }: { filter: Filter; animate?: boolean }) {
  const isAll = filter === "all";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center",
        animate && "animate-in fade-in-0 zoom-in-95 duration-300",
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <ListTodo className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-base font-semibold">{isAll ? "No tasks yet" : "Nothing here"}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {isAll
          ? "Create your first task, then tap Quick log each time you do it to start tracking the time since."
          : "No tasks match this view right now."}
      </p>
      {isAll && (
        <div className="mt-5">
          <CreateTaskDialog />
        </div>
      )}
    </div>
  );
}

function GridSkeleton({ stagger = true }: { stagger?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        // Staggered pulse so the placeholder reads as a wave, not a strobe.
        <div
          key={i}
          className="h-48 animate-pulse rounded-xl border bg-muted/40"
          style={stagger ? { animationDelay: `${i * 120}ms` } : undefined}
        />
      ))}
    </div>
  );
}
