import { useEffect, useRef } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { useTheme } from "@/components/ThemeProvider";
import { DEFAULT_THEME, loadSavedThemes, type Theme } from "@/lib/theme";
import { type Prefs, usePrefs } from "@/lib/prefs";

interface StoredPrefs {
  theme?: Partial<Theme>;
  prefs?: Partial<Prefs>;
}

/**
 * PreferencesSync persists the theme + layout prefs per account, server-side.
 *
 * The old behaviour kept everything in localStorage, so a person's theme was
 * shared by every account on that browser ("changing the theme changed it for
 * everyone"). Now, when the signed-in user changes we load *their* saved
 * preferences and apply them; subsequent edits are debounced back to the server,
 * so a user's look-and-feel follows their account and never bleeds across users.
 *
 * Renders nothing — it just bridges the providers to the API. Mounted inside the
 * app (i.e. only while signed in).
 */
export function PreferencesSync() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { prefs, setPrefs } = usePrefs();

  const loadedFor = useRef<number | null>(null);
  const hydrated = useRef(false);
  // Keep the freshest values for the "seed the server on first login" path
  // without making them effect dependencies.
  const latest = useRef({ theme, prefs });
  latest.current = { theme, prefs };

  // Load this account's saved preferences whenever the signed-in user changes.
  useEffect(() => {
    if (!user) {
      loadedFor.current = null;
      hydrated.current = false;
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    hydrated.current = false;
    let cancelled = false;

    api
      .getPreferences()
      .then((data) => {
        if (cancelled) return;
        const stored = (data ?? {}) as StoredPrefs;
        const hasStored = Boolean(stored.theme || stored.prefs);
        if (stored.theme) setTheme({ ...DEFAULT_THEME, ...stored.theme } as Theme);
        if (stored.prefs) setPrefs(stored.prefs);
        // One-time migration: saved themes used to live in localStorage and were
        // wiped on logout. If this account has none stored yet, adopt whatever is
        // still in localStorage so it isn't lost — it then syncs to the account.
        if (!stored.prefs?.savedThemes?.length) {
          const legacy = loadSavedThemes();
          if (legacy.length) setPrefs({ savedThemes: legacy });
        }
        hydrated.current = true;
        // First time on this account: seed the server with the current values.
        if (!hasStored) {
          api.putPreferences({ theme: latest.current.theme, prefs: latest.current.prefs }).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) hydrated.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, user, setTheme, setPrefs]);

  // Persist changes back to the account (debounced), once we've hydrated so we
  // never overwrite the just-loaded values with stale local ones.
  useEffect(() => {
    if (!user || !hydrated.current) return;
    const id = setTimeout(() => {
      api.putPreferences({ theme, prefs }).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [theme, prefs, user]);

  return null;
}
