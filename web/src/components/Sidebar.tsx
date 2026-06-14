import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LogOut, Settings, X } from "lucide-react";

import { api } from "@/lib/api";
import { type Filter, FILTERS } from "@/lib/filters";
import { clearStoredPreferences, usePrefs } from "@/lib/prefs";
import { DEFAULT_THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/Branding";
import { Button } from "@/components/ui/button";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { SettingsPanel } from "@/components/SettingsPanel";
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
  onClose,
}: {
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  counts: Record<Filter, number>;
  onClose?: () => void;
}) {
  const windows = useWindows();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const { prefs } = usePrefs();
  const branding = useBranding();
  const navRef = useRef<HTMLElement>(null);
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
    <div className="flex h-full w-60 flex-col overflow-y-auto border-r border-border/60 bg-sidebar p-4">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {branding.icon ? (
            <img src={branding.icon} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover shadow" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow">
              <CheckCircle2 className="h-5 w-5" />
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

      <CreateTaskDialog />

      {/* flex+gap (not space-y) so the absolutely-positioned highlight doesn't
          pick up a sibling margin; the bubble glides to the selected view. */}
      <nav ref={navRef} className="relative mt-6 flex flex-col gap-1">
        <SlidingHighlight containerRef={navRef} activeKey={filter} className="rounded-md bg-primary/15" />
        {FILTERS.map((f) => {
          const active = filter === f.key;
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
              <span>{f.label}</span>
              {/* Keyed by the value so a changing count pops in. */}
              <span
                key={counts[f.key]}
                className={cn("text-xs tabular-nums", prefs.animFeedback && "animate-in zoom-in-75 duration-200")}
              >
                {counts[f.key]}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 pt-4">
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
          <span className="text-[11px] text-muted-foreground">v{__APP_VERSION__}</span>
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
      </div>
    </div>
  );
}
