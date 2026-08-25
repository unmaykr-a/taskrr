import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FolderTree,
  Folder as FolderIcon,
  ListTodo,
  Menu,
  Plus,
  Search,
  Share2,
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
import { type Shortcut, useKeyboardShortcuts } from "@/lib/useKeyboardShortcuts";
import { describeKey, resolveKey } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Sidebar } from "@/components/Sidebar";
import { RequestsView } from "@/components/RequestsView";
import { TaskCard } from "@/components/TaskCard";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { useBackgroundImageUrl } from "@/components/BackgroundImage";
import { Calendar } from "@/components/Calendar";
import { ActivityChart } from "@/components/ActivityChart";
import { BulkBar } from "@/components/BulkBar";
import { PreferencesSync } from "@/components/PreferencesSync";
import { WhatsNew } from "@/components/WhatsNew";
import { type ShortcutHelp, ShortcutsDialog } from "@/components/ShortcutsDialog";
import { FolderShareDialog } from "@/components/FolderShareDialog";
import { ContextMenu, type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useAuth } from "@/components/AuthProvider";

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
  const { user } = useAuth();
  const { alert } = useConfirm();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);

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
  // Keyboard-shortcut targets: the search box to focus, and the two dialogs the
  // shortcuts open without a button to click.
  const searchRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Which folder the share dialog is for (null = closed).
  const [shareFolder, setShareFolder] = useState<{ folder: string; taskCount: number } | null>(null);
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
  const { data: folderInvites } = useQuery({
    queryKey: ["folder-invites"],
    queryFn: api.listFolderInvites,
    enabled: shareEnabled,
  });
  // Both kinds of invitation land in the same view, so the badge counts both.
  const requestCount = (incoming?.length ?? 0) + (folderInvites?.length ?? 0);

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
      snoozed: 0,
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
      if (s === "due-soon" || s === "overdue" || s === "none" || s === "snoozed") c[s] += 1;
    }
    return c;
  }, [tasks, now, requestCount]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => matchesFilter(t, filter, now));
    if (activeFolder) {
      list = list.filter((t) => t.folder.toLowerCase() === activeFolder.toLowerCase());
    }
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
  }, [tasks, filter, now, search, activeTag, activeFolder, prefs.sortBy]);

  // --- keyboard shortcuts -----------------------------------------------------
  // Single unmodified keys, matching the sidebar's own order so "3" lands on
  // whatever the third view is rather than on a hard-coded filter. Bindings are
  // rebuilt each render (cheap) so they always close over current state.
  const navFilters = useMemo(
    () => (shareEnabled ? [...FILTERS, ...SHARE_FILTERS] : FILTERS),
    [shareEnabled],
  );
  // Folders in use, with how many active tasks are in each. Derived rather than
  // stored, so a folder appears the moment a task is moved into it and vanishes
  // when the last one leaves.
  const folderCounts = useMemo(() => {
    const byName = new Map<string, { name: string; count: number }>();
    for (const t of tasks ?? []) {
      if (t.archivedAt != null || !t.folder) continue;
      const key = t.folder.toLowerCase();
      const seen = byName.get(key);
      if (seen) seen.count += 1;
      else byName.set(key, { name: t.folder, count: 1 });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // Keys come from the user's bindings, falling back to the defaults — see
  // lib/shortcuts.ts for why only these four are rebindable.
  const bound = prefs.shortcutKeys;
  const shortcuts = useMemo<Shortcut[]>(() => {
    const list: Shortcut[] = [
      { key: resolveKey(bound, "new"), label: "New task", run: () => setCreateOpen(true) },
      {
        key: resolveKey(bound, "search"),
        label: "Search tasks",
        run: () => {
          setSidebarOpen(false);
          searchRef.current?.focus();
          searchRef.current?.select();
        },
      },
      { key: resolveKey(bound, "help"), label: "Show this help", run: () => setShortcutsOpen((v) => !v) },
      {
        key: resolveKey(bound, "clear"),
        label: "Clear search and selection",
        run: () => {
          setSearch("");
          setActiveTag(null);
          setActiveFolder(null);
          clearSelection();
        },
      },
    ];
    navFilters.forEach((f, i) => {
      if (i > 8) return; // only single digits get a key
      list.push({
        key: String(i + 1),
        label: `Go to ${f.label}`,
        run: () => {
          setFilter(f.key);
          setSidebarOpen(false);
          setSelected(new Set());
        },
      });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navFilters, bound]);
  useKeyboardShortcuts(shortcuts, prefs.keyboardShortcuts);

  // Grouped for the help overlay: the digits collapse into one row so the list
  // doesn't become seven near-identical lines.
  // Reads the live bindings rather than the defaults, or the "?" overlay would
  // keep confidently naming keys the user has since moved.
  const shortcutHelp = useMemo<ShortcutHelp[]>(
    () => [
      { keys: [describeKey(resolveKey(bound, "new"))], label: "New task" },
      { keys: [describeKey(resolveKey(bound, "search"))], label: "Search tasks" },
      { keys: ["1", "…", String(Math.min(9, navFilters.length))], label: "Switch view" },
      { keys: [describeKey(resolveKey(bound, "clear"))], label: "Clear search and selection" },
      { keys: [describeKey(resolveKey(bound, "help"))], label: "Show this help" },
    ],
    [navFilters.length, bound],
  );

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

  // Whether a background picture is up, which a couple of deliberately
  // transparent controls need to know about (see the search field below).
  const onPicture = !!useBackgroundImageUrl();

  // Auto columns: fit as many as the space actually has room for, rather than
  // stepping at viewport widths. The two are not the same question — hiding the
  // calendar hands the list ~320px back, which is another whole column that a
  // `2xl:grid-cols-3` rule could never notice, and on a 1080p screen that was
  // the difference between three roomy columns and the four that fit. minmax
  // against a per-density floor is the whole rule; min(100%) keeps a single
  // card from overflowing a phone narrower than the floor.
  const columnFloor = prefs.cardSize === "compact" ? "16rem" : "20rem";
  const gridClassName = "grid gap-4";
  const gridStyle =
    prefs.taskColumns > 0 && !compact
      ? { gridTemplateColumns: `repeat(${prefs.taskColumns}, minmax(0, 1fr))` }
      : { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${columnFloor}), 1fr))` };
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
      {/* Opened by the "n" shortcut — trigger-less, since the buttons that
          normally open this form render their own instances. */}
      <CreateTaskDialog hideTrigger open={createOpen} onOpenChange={setCreateOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} shortcuts={shortcutHelp} />
      {shareFolder && (
        <FolderShareDialog
          folder={shareFolder.folder}
          taskCount={shareFolder.taskCount}
          open
          onOpenChange={(o) => !o && setShareFolder(null)}
        />
      )}
      <div className={cn("relative z-10 flex", sideBySide ? "h-[100dvh] overflow-hidden" : "min-h-[100dvh]")}>
        {/* Mobile/landscape drawer scrim */}
        {compact && sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 animate-in fade-in-0 duration-200"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar: static column on large screens, off-canvas drawer when
            compact — and collapsible out of the way on desktop, which hands the
            task list another 15rem (often another column). */}
        <aside
          className={cn(
            "left-0 will-change-transform",
            !compact && prefs.sidebarCollapsed && "hidden",
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
            folders={folderCounts}
            activeFolder={activeFolder}
            onFolderChange={(f) => {
              setActiveFolder(f);
              setSidebarOpen(false);
              setSelected(new Set());
            }}
            shareEnabled={shareEnabled}
            onClose={() => setSidebarOpen(false)}
            onCollapse={compact ? undefined : () => setPrefs({ sidebarCollapsed: true })}
          />
        </aside>

        {/* Main column */}
        <div className={cn("flex min-w-0 flex-1 flex-col", sideBySide && "h-full overflow-hidden")}>
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur">
            {(compact || prefs.sidebarCollapsed) && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  compact ? setSidebarOpen(true) : setPrefs({ sidebarCollapsed: false })
                }
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
                      ref={searchRef}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search tasks"
                      aria-label="Search tasks"
                      className={cn(
                        "h-9 w-full rounded-md border border-input bg-transparent pl-8 pr-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        // These two sit straight on the page rather than on a
                        // card, and are see-through by design. Over a picture
                        // that means typing onto a photograph, so they get a
                        // surface of their own when one is up.
                        onPicture && "bg-background/70",
                      )}
                    />
                  </div>
                  {activeFolder && (
                    <button
                      type="button"
                      onClick={() => setActiveFolder(null)}
                      title="Show every folder again"
                      className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-1.5 text-xs font-medium text-primary"
                    >
                      <FolderIcon className="h-3 w-3" />
                      {activeFolder}
                      <X className="h-3 w-3" />
                    </button>
                  )}
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
                    className={cn(
                      "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      onPicture && "bg-background/70",
                    )}
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
                (search.trim() || activeTag || activeFolder ? (
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
                    // Only a named folder of your own can be shared: "No folder"
                    // is not a folder, and sharing someone else's grouping is
                    // theirs to do.
                    const canShare =
                      shareEnabled && folder !== "" && folderTasks.some((t) => !user || t.ownerId === user.id);
                    const folderMenu = (): ContextMenuEntry[] =>
                      canShare
                        ? [
                            {
                              label: "Share this folder…",
                              icon: <Share2 />,
                              onSelect: () => setShareFolder({ folder, taskCount: folderTasks.length }),
                            },
                          ]
                        : [];
                    return (
                      <section key={folder || "__none"}>
                        <ContextMenu entries={folderMenu} disabled={!canShare}>
                          <div className="mb-2 flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleFolder(folder)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-semibold"
                            >
                              {isCollapsed ? (
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : (
                                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                              )}
                              <span className="truncate">{folder || "No folder"}</span>
                              <span className="text-xs font-normal text-muted-foreground">{folderTasks.length}</span>
                            </button>
                            {canShare && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
                                aria-label={`Share the ${folder} folder`}
                                title="Share this folder"
                                onClick={() => setShareFolder({ folder, taskCount: folderTasks.length })}
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </ContextMenu>
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
        <BulkBar tasks={visible} ids={selectedIds} archivedView={archivedView} onClear={clearSelection} />
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
