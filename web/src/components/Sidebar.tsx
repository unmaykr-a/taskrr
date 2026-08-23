import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Folder as FolderIcon, LogOut, Settings, X } from "lucide-react";

import { api } from "@/lib/api";
import { type Filter, FILTERS, SHARE_FILTERS } from "@/lib/filters";
import { clearStoredPreferences, usePrefs } from "@/lib/prefs";
import { DEFAULT_THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/Branding";
import { Button } from "@/components/ui/button";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { currentRelease, formatReleaseDate } from "@/lib/releases";
import { useAuth } from "@/components/AuthProvider";
import { useTheme } from "@/components/ThemeProvider";
import { useWindows } from "@/components/windows/WindowManager";

// Build-time version string, surfaced in the footer. Vite replaces import.meta
// env values at build time; APP_VERSION is injected in vite.config.ts.
declare const __APP_VERSION__: string;

/**
 * Sidebar is purely presentational: it renders the brand, the "new task"
 * action, the filter views, and the theme toggle. The parent (App) owns the
 * selected filter and whether the sidebar is shown as a mobile drawer.
 */
export function Sidebar({
  filter,
  onFilterChange,
  counts,
  folders = [],
  activeFolder = null,
  onFolderChange,
  shareEnabled = false,
  onClose,
}: {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  counts: Record<Filter, number>;
  /** Folders in use, with how many active tasks each holds. */
  folders?: { name: string; count: number }[];
  activeFolder?: string | null;
  onFolderChange?: (folder: string | null) => void;
  /** Whether task sharing is on (shows the Shared + Requests views). */
  shareEnabled?: boolean;
  onClose?: () => void;
}) {
  const windows = useWindows();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const { prefs } = usePrefs();
  const branding = useBranding();
  const navRef = useRef<HTMLElement>(null);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const release = currentRelease();
  // Signing out: close every open window and wipe the query cache so the next
  // account never sees the previous user's tasks/calendar (their data is
  // owner-scoped server-side, so stale cache is the only leak — and editing it
  // would 404). Set `me` to null directly so the login page shows immediately
  // (no reload needed).
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      windows.closeAll();
      clearStoredPreferences();
      // Reset to the built-in theme so the login screen doesn't keep the previous
      // user's look on a shared browser (AuthPage then applies the site default).
      setTheme(DEFAULT_THEME);
      queryClient.setQueryData(["me"], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });

  return (
    // Only the views and folders scroll. The branding above and the account and
    // Settings below are how you get out of wherever you are, so they stay put
    // rather than being scrolled off by a long folder list. Padding moved onto
    // the three bands so the scrollbar runs inside the list, not down the edge
    // of the whole sidebar.
    <div className="flex h-full w-60 flex-col overflow-hidden border-r border-border/60 bg-sidebar">
      <div className="flex items-center justify-between p-4 pb-0">
        <div className="flex min-w-0 items-center gap-2.5">
          {branding.icon ? (
            <img src={branding.icon} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover shadow" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
              <Check className="h-5 w-5" strokeWidth={3} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-none tracking-tight">{branding.name}</h1>
            {branding.tagline && (
              <p className="truncate text-[11px] text-muted-foreground">{branding.tagline}</p>
            )}
          </div>
        </div>
        {/* Close button only matters in the mobile drawer. */}
        {onClose && (
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose} aria-label="Close menu">
            <X />
          </Button>
        )}
      </div>

      <div className="px-4 pt-6">
        <CreateTaskDialog />
      </div>

      {/* The scrolling band. min-h-0 is what lets it actually shrink inside the
          flex column instead of pushing the footer off the bottom. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
      {/* flex+gap (not space-y) so the absolutely-positioned highlight doesn't
          pick up a sibling margin; the bubble glides to the selected view. */}
      <nav ref={navRef} className="relative mt-6 flex flex-col gap-1">
        <SlidingHighlight containerRef={navRef} activeKey={filter} className="rounded-md bg-primary/15" />
        {(shareEnabled ? [...FILTERS, ...SHARE_FILTERS] : FILTERS).map((f) => {
          const active = filter === f.key;
          // A pending invite gives the Requests view a calm accent pulse.
          const pulse = f.key === "requests" && counts.requests > 0;
          return (
            <button
              key={f.key}
              data-slide-key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                "relative flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors duration-200",
                active
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {/* Accent tick that grows in beside the active view. */}
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-all duration-200",
                  active ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                )}
              />
              <span className="flex items-center gap-1.5">
                {f.label}
                {pulse && (
                  <span
                    aria-hidden
                    className={cn("h-1.5 w-1.5 rounded-full bg-primary", prefs.animFeedback && "animate-pulse")}
                  />
                )}
              </span>
              {/* Keyed by the value so a changing count pops in. */}
              <span
                key={counts[f.key]}
                className={cn(
                  "text-xs tabular-nums",
                  pulse && "font-medium text-primary",
                  prefs.animFeedback && "animate-in zoom-in-75 duration-200",
                )}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Folders narrow whichever view is open rather than being a view of their
          own — the same thing clicking a tag on a card does. Only shown when
          there are folders to pick between.

          Set apart from the views above with a rule and a labelled heading: the
          rows are the same shape as the view rows, so without a break the list
          just looked like more views with odd names. */}
      {folders.length > 0 && (
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="mb-1 flex items-center justify-between gap-2 px-3">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <FolderIcon className="h-3 w-3" />
              Folders
            </span>
            {/* Only while one is picked: says the list is narrowed, and undoes it
                without having to remember which folder is on. */}
            {activeFolder && (
              <button
                type="button"
                onClick={() => onFolderChange?.(null)}
                className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            )}
          </div>
          <div className="space-y-1">
            {folders.map((f) => {
              const active = activeFolder?.toLowerCase() === f.name.toLowerCase();
              return (
                <button
                  key={f.name}
                  onClick={() => onFolderChange?.(active ? null : f.name)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 truncate">{f.name}</span>
                  <span className="shrink-0 text-xs tabular-nums">{f.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      </div>

      <div className="space-y-2 border-t border-border/60 p-4">
        {/* Current account + sign out */}
        <div className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user?.username}</p>
            <p className="text-[10px] capitalize text-muted-foreground">{user?.role}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Sign out"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            title={release ? `Released ${formatReleaseDate(release.date)}` : undefined}
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            v{__APP_VERSION__}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              windows.open({
                id: "settings",
                title: "Settings",
                width: 640,
                content: <SettingsPanel />,
              })
            }
          >
            <Settings /> Settings
          </Button>
        </div>
        <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
      </div>
    </div>
  );
}
