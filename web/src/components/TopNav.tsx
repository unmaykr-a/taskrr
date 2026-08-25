import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, LogOut, Plus, Settings } from "lucide-react";

import { api } from "@/lib/api";
import { type Filter, FILTERS, SHARE_FILTERS } from "@/lib/filters";
import { clearStoredPreferences, usePrefs } from "@/lib/prefs";
import { currentRelease, formatReleaseDate } from "@/lib/releases";
import { DEFAULT_THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { useBranding } from "@/components/Branding";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
import { useTheme } from "@/components/ThemeProvider";
import { Button } from "@/components/ui/button";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { useWindows } from "@/components/windows/WindowManager";

declare const __APP_VERSION__: string;

/**
 * The top-bar layout's navigation: brand on the left, the views as tabs across
 * the middle, account and settings on the right.
 *
 * The same views and counts the sidebar shows, arranged horizontally so the
 * content underneath gets the full width of the window. Folders don't fit here
 * — a row of tabs is already as wide as it wants to be — so they move to the
 * folder picker in the toolbar, which is where every layout without a folder
 * list finds them.
 */
export function TopNav({
  filter,
  onFilterChange,
  counts,
  shareEnabled = false,
}: {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  counts: Record<Filter, number>;
  shareEnabled?: boolean;
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

  // Same teardown as the sidebar's sign-out: close windows, drop the cache so
  // the next account never sees the previous one's list, reset the theme.
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      windows.closeAll();
      clearStoredPreferences();
      setTheme(DEFAULT_THEME);
      queryClient.setQueryData(["me"], null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });

  const views = shareEnabled ? [...FILTERS, ...SHARE_FILTERS] : FILTERS;

  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border/60 bg-sidebar px-4 py-2">
      <div className="flex shrink-0 items-center gap-2.5">
        {branding.icon ? (
          <img src={branding.icon} alt="" className="h-8 w-8 rounded-lg object-cover shadow" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
            <Check className="h-4 w-4" strokeWidth={3} />
          </div>
        )}
        <h1 className="hidden text-sm font-semibold leading-none tracking-tight lg:block">
          {branding.name}
        </h1>
      </div>

      {/* The tabs scroll rather than wrap: a nav bar that grows a second row
          when the Requests view appears would shift the whole page down. */}
      <nav ref={navRef} className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <SlidingHighlight containerRef={navRef} activeKey={filter} className="rounded-md bg-primary/15" />
        {views.map((f) => {
          const active = filter === f.key;
          const pulse = f.key === "requests" && counts.requests > 0;
          return (
            <button
              key={f.key}
              data-slide-key={f.key}
              onClick={() => onFilterChange(f.key)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-200",
                active
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {f.label}
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
              {pulse && (
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 rounded-full bg-primary", prefs.animFeedback && "animate-pulse")}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* A phone has no room for the label beside a row of tabs, so the
            button becomes the icon it already is on the rest of the screen. */}
        <CreateTaskDialog
          trigger={
            <Button size="icon" className="sm:hidden" aria-label="New task" title="New task">
              <Plus />
            </Button>
          }
        />
        <span className="hidden sm:inline">
          <CreateTaskDialog />
        </span>
        <button
          type="button"
          onClick={() => setChangelogOpen(true)}
          title={release ? `Released ${formatReleaseDate(release.date)}` : undefined}
          className="hidden text-[11px] text-muted-foreground transition-colors hover:text-foreground xl:inline"
        >
          v{__APP_VERSION__}
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Settings"
          title="Settings"
          onClick={() =>
            windows.open({ id: "settings", title: "Settings", width: 640, content: <SettingsPanel /> })
          }
        >
          <Settings />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Sign out"
          title={user ? `Sign out (${user.username})` : "Sign out"}
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <LogOut />
        </Button>
      </div>
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
    </div>
  );
}
