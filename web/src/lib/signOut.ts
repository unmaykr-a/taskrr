import type { QueryClient } from "@tanstack/react-query";

import { type AuthConfig } from "@/lib/api";
import { clearStoredPreferences } from "@/lib/prefs";
import { DEFAULT_THEME, type Theme } from "@/lib/theme";

/**
 * Tearing down a signed-in session: what the app forgets when someone leaves.
 *
 * Everything the account brought with it goes - its tasks, its preferences, its
 * theme - so a shared browser never shows one person's list or look to the next.
 * What stays is the instance's own config: its name, icon, background, login
 * layout and default theme belong to the server, and the sign-in screen about to
 * render is built from them.
 *
 * That distinction is the whole point. Dropping the config too meant signing out
 * flashed stock Taskrr - the built-in colours, the plain login card - for as long
 * as it took to ask the server what this instance looks like, before redrawing as
 * itself.
 *
 * The theme is set here rather than left to the sign-in page for the same reason:
 * one render with the previous account's colours, or with the built-in ones, is
 * one render too many.
 */
export function endSession(queryClient: QueryClient, setTheme: (theme: Theme) => void) {
  clearStoredPreferences();
  const config = queryClient.getQueryData<AuthConfig>(["auth-config"]);
  setTheme({ ...DEFAULT_THEME, ...(config?.defaultTheme ?? {}) });
  queryClient.setQueryData(["me"], null);
  queryClient.removeQueries({
    predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "auth-config",
  });
}
