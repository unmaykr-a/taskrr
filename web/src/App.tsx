import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FolderTree,
  ListTodo,
  Menu,
  Plus,
  Search,
  X,
} from "lucide-react";

import { api, type Task } from "@/lib/api";
import { type Filter, FILTERS, matchesFilter, SHARE_FILTERS } from "@/lib/filters";
import { type SortKey, SORT_OPTIONS, sortTasks } from "@/lib/sort";
import { taskStaleness } from "@/lib/staleness";
import { usePrefs } from "@/lib/prefs";
import { useFlip } from "@/lib/useFlip";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Sidebar } from "@/components/Sidebar";
import { RequestsView } from "@/components/RequestsView";
import { TaskCard } from "@/components/TaskCard";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { Calendar } from "@/components/Calendar";
import { ActivityChart } from "@/components/ActivityChart";
import { BulkBar } from "@/components/BulkBar";
import { PreferencesSync } from "@/components/PreferencesSync";
import { WhatsNew } from "@/components/WhatsNew";

// Human-readable result of an OIDC account-link attempt (see the callback in
// internal/api/oidc.go, which redirects back here with ?oidcLink=...).
const OIDC_LINK_MESSAGES: Record<string, string> = {
  linked: "Single sign-on connected to your account.",
  conflict: "That single sign-on identity is already linked to another account.",
  error: "Could not connect single sign-on. Please try again.",
};

export default function App() {
  const now = useNow(); // ticking clock so staleness/counts refresh over time
  const { prefs, setPrefs } = usePrefs();
  const { alert } = useConfirm();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  // After returning from an OIDC link attempt, surface the outcome and refresh
  // the cached user so the Settings UI reflects the new link state, then strip
  // the query param so a reload doesn't repeat the toast.
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("oidcLink");
    if (!result) return;
    const message = OIDC_LINK_MESSAGES[result] ?? OIDC_LINK_MESSAGES.error;
    if (result === "linked") queryClient.invalidateQueries({ queryKey: ["me"] });
    window.history.replaceState({}, "", window.location.pathname);
    void alert({ title: "Single sign-on", description: message });
  }, [queryClient, alert]);
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

  // Sharing: whether the feature is enabled (gates the Shared/Requests views),
  // and the current count of incoming invites (drives the Requests pulse).
  const { data: authConfig } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const shareEnabled = authConfig?.tasksShareable ?? false;
  const { data: incoming } = useQuery({
    queryKey: ["incoming-shares"],
    queryFn: api.listIncomingShares,
    enabled: shareEnabled,
  });
  const requestCount = incoming?.length ?? 0;

  // Animate task-grid layout changes: when a quick log / filter change / new
  // task reorders the grid, surviving cards glide to their new spot and
  // appearing ones fade in (see useFlip). Cards opt in via data-flip-key.
  const gridRef = useRef<HTMLDivElement>(null);
  useFlip(gridRef, prefs.animGrid);
  const views = prefs.animViews; // gate for the decorative view transitions

  // Counts per sidebar view (recomputed as time passes via `now`). Archived
  // tasks are excluded from the active views and counted on their own.
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: 0,
      "due-soon": 0,
      overdue: 0,
      none: 0,
      archived: 0,
      shared: 0,
      requests: requestCount,
    };
    for (const t of tasks) {
      if (t.archivedAt != null) {
        c.archived += 1;
        continue;
      }
      c.all += 1;
      if (t.shared) c.shared += 1;
      const s = taskStaleness(t, now);
      if (s === "due-soon" || s === "overdue" || s === "none") c[s] += 1;
    }
    return c;
  }, [tasks, now, requestCount]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => matchesFilter(t, filter, now));
    if (activeTag) {
      list = list.filter((t) => t.tags.some((tag) => tag.toLowerCase() === activeTag.toLowerCase()));
    }
    if (q) {
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)),
      );
    }
    return sortTasks(list, prefs.sortBy);
  }, [tasks, filter, now, search, activeTag, prefs.sortBy]);

  const filterLabel =
    [...FILTERS, ...SHARE_FILTERS].find((f) => f.key === filter)?.label ?? "Tasks";
  const archivedView = filter === "archived";
  const requestsView = filter === "requests";

  // Folder grouping: collapsible sections (named folders A-Z, then "No folder").
  const grouped = prefs.groupByFolder && !requestsView;
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const toggleFolder = (folder: string) =>
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of visible) {
      const key = t.folder || "";
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    const named = [...map.keys()]
      .filter((k) => k !== "")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const order = map.has("") ? [...named, ""] : named;
    return order.map((folder) => ({ folder, tasks: map.get(folder)! }));
  }, [visible]);

  const gridClassName = cn(
    "grid gap-4",
    (prefs.taskColumns === 0 || compact) && "grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3",
  );
  const gridStyle =
    prefs.taskColumns > 0 && !compact
      ? { gridTemplateColumns: `repeat(${prefs.taskColumns}, minmax(0, 1fr))` }
      : undefined;
  const renderCard = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      selectable={selectMode}
      selected={selected.has(task.id)}
      onToggleSelected={() => toggleSelected(task.id)}
      onTagClick={(tag) => {
        setActiveTag(tag);
        setFilter("all");
      }}
    />
  );
  // Only act on selected tasks that are actually in the current view.
  const selectedIds = useMemo(
    () => visible.filter((t) => selected.has(t.id)).map((t) => t.id),
    [visible, selected],
  );

  return (
    <>
      {/* Load/save this account's theme + layout prefs server-side. */}
      <PreferencesSync />
      {/* One-off "what's new" dialog after a version update. */}
      <WhatsNew />
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
            "left-0 will-change-transform",
            compact
              ? cn(
                  "fixed inset-y-0 z-50 transition-transform duration-300 ease-in-out",
                  sidebarOpen ? "translate-x-0" : "-translate-x-full",
                )
              : // Desktop: stick to the top and always fill the viewport height, so
                // the nav and footer stay in place instead of scrolling away with
                // the page on shorter layouts.
                "sticky top-0 z-auto h-[100dvh]",
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
            shareEnabled={shareEnabled}
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
                {requestsView
                  ? `${requestCount} ${requestCount === 1 ? "request" : "requests"}`
                  : `${visible.length} ${visible.length === 1 ? "task" : "tasks"}`}
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
              {!requestsView && tasks.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[8rem] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search tasks"
                      aria-label="Search tasks"
                      className="h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  {activeTag && (
                    <button
                      type="button"
                      onClick={() => setActiveTag(null)}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1.5 text-xs font-medium text-primary"
                    >
                      {activeTag}
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  <select
                    value={prefs.sortBy}
                    onChange={(e) => setPrefs({ sortBy: e.target.value as SortKey })}
                    aria-label="Sort tasks"
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {SORT_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant={prefs.groupByFolder ? "secondary" : "outline"}
                    size="sm"
                    className="h-9"
                    aria-pressed={prefs.groupByFolder}
                    title="Group by folder"
                    onClick={() => setPrefs({ groupByFolder: !prefs.groupByFolder })}
                  >
                    <FolderTree /> Group
                  </Button>
                </div>
              )}

              {requestsView && <RequestsView animate={views} />}

              {!requestsView && isLoading && <GridSkeleton stagger={views} />}

              {!requestsView && isError && (
                <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  Failed to load tasks: {(error as Error).message}
                </div>
              )}

              {!requestsView && !isLoading && !isError && visible.length === 0 &&
                (search.trim() || activeTag ? (
                  <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                    No tasks match.
                  </p>
                ) : (
                  <EmptyState filter={filter} animate={views} />
                ))}

              {/* Flat grid (default). A fixed column count is for roomy screens
                  only — phones / landscape phones fall back to the responsive
                  1→2→3 grid so cards don't get crushed into slivers. */}
              {!requestsView && !grouped && visible.length > 0 && (
                <div ref={gridRef} className={gridClassName} style={gridStyle}>
                  {visible.map(renderCard)}
                </div>
              )}

              {/* Grouped into collapsible folder sections. */}
              {!requestsView && grouped && visible.length > 0 && (
                <div className="space-y-5">
                  {groups.map(({ folder, tasks: folderTasks }) => {
                    const isCollapsed = collapsedFolders.has(folder);
                    return (
                      <section key={folder || "__none"}>
                        <button
                          type="button"
                          onClick={() => toggleFolder(folder)}
                          className="mb-2 flex w-full items-center gap-1.5 text-sm font-semibold"
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span>{folder || "No folder"}</span>
                          <span className="text-xs font-normal text-muted-foreground">{folderTasks.length}</span>
                        </button>
                        {!isCollapsed && (
                          <div className={gridClassName} style={gridStyle}>
                            {folderTasks.map(renderCard)}
                          </div>
                        )}
                      </section>
                    );
                  })}
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
