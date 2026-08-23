import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, type Branding as BrandingData } from "@/lib/api";
import { setBrandIcon } from "@/lib/theme";
import { taskStaleness } from "@/lib/staleness";
import { usePrefs } from "@/lib/prefs";
import { useNow } from "@/lib/useNow";
import { useAuth } from "@/components/AuthProvider";

const DEFAULTS: BrandingData = {
  name: "Taskrr",
  title: "",
  tagline: "last-done tracker",
  icon: "",
  loginHideIcon: false,
  loginHideText: false,
};

/** Read the instance branding from auth config (with defaults). Available
 *  signed-in and signed-out, since the login page is branded too. */
export function useBranding(): BrandingData {
  const { data } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  return data?.branding ?? DEFAULTS;
}

/**
 * How many tasks want attention right now: overdue or due soon, matching what
 * the sidebar counts so the badge and the list never disagree. Snoozed and
 * archived tasks are excluded by taskStaleness itself.
 *
 * Reads the same ["tasks"] cache entry the app already holds, so switching the
 * badge on costs no extra request. Zero while signed out or switched off.
 */
function useAttentionCount(): number {
  const { prefs } = usePrefs();
  const { user } = useAuth();
  const enabled = prefs.tabBadge && !!user;
  const { data: tasks } = useQuery({ queryKey: ["tasks"], queryFn: api.listTasks, enabled });
  const now = useNow();

  return useMemo(() => {
    if (!enabled || !tasks) return 0;
    return tasks.filter((t) => {
      if (t.archivedAt != null) return false;
      const s = taskStaleness(t, now);
      return s === "overdue" || s === "due-soon";
    }).length;
  }, [enabled, tasks, now]);
}

/**
 * Applies the instance branding that lives outside React's tree: the document
 * (tab) title and the favicon. Mounted once near the root; renders nothing.
 */
export function BrandingApplier() {
  const branding = useBranding();
  const badgeCount = useAttentionCount();

  // The tab title, optionally prefixed with how many tasks want attention —
  // the point of a pinned tab. Deliberately the only place that writes
  // document.title, so the two concerns can't fight over it.
  useEffect(() => {
    const base = branding.title.trim() || branding.name.trim() || "Taskrr";
    document.title = badgeCount > 0 ? `(${badgeCount}) ${base}` : base;
  }, [branding.title, branding.name, badgeCount]);

  // A custom icon overrides the generated checkmark favicon; clearing it falls
  // back to the theme-coloured mark.
  useEffect(() => {
    setBrandIcon(branding.icon || null);
  }, [branding.icon]);

  return null;
}
