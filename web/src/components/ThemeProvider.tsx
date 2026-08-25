import { type ReactNode, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import {
  applyTheme,
  loadTheme,
  persistTheme,
  resolveStyle,
  type Theme,
  ThemeContext,
} from "@/lib/theme";

/**
 * ThemeProvider holds the active theme, applies it to the document, and persists
 * it. Anything under it can read/update the theme via useTheme(), so the sidebar
 * toggle and the Theme customizer stay in sync.
 *
 * The interface *style* is the one part the instance has a say in. It is
 * resolved rather than read straight off the theme: the flat styles exist only
 * where the operator opted in, a theme that names a style gets it, and a theme
 * that doesn't follows whatever the admin set for the instance — which is what
 * makes the signed-out login page look like the rest of the instance.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const experimental = config?.experimental ?? false;
  const instanceStyle = config?.branding.style;

  useEffect(() => {
    applyTheme(theme, resolveStyle(theme, instanceStyle, experimental));
    // Stored as chosen: the theme is not rewritten just because this instance
    // won't render it that way today.
    persistTheme(theme);
  }, [theme, experimental, instanceStyle]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
