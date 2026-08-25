import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { type AppLayout, resolveLayout } from "@/lib/layout";
import { usePrefs } from "@/lib/prefs";

/**
 * Which navigation layout is actually in force: the account's choice, the
 * instance's default, or the sidebar — resolved in one place so the app and the
 * settings window can't disagree about which one is on screen.
 */
export function useAppLayout(): AppLayout {
  const { prefs } = usePrefs();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  return resolveLayout(prefs.appLayout, config?.branding.layout, config?.experimental ?? false);
}
