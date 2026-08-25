import { type ReactNode, useContext, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { applyTheme, loadTheme, persistTheme, type Theme, ThemeContext } from "@/lib/theme";

/**
 * ThemeProvider holds the active theme, applies it to the document, and persists
 * it. Anything under it can read/update the theme via useTheme(), so the sidebar
 * toggle and the Theme customizer stay in sync.
 *
 * The interface *style* is the one part the instance has a say in: the flat
 * styles are experimental, so a theme carrying one is applied with its usual
 * shape unless the operator opted in. That keeps a theme somebody imported (or
 * an admin published) from restyling an instance that never asked for it, and
 * means turning the switch back off puts everyone's app back the way it was.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const experimental = config?.experimental ?? false;

  useEffect(() => {
    applyTheme(experimental ? theme : { ...theme, style: "soft" });
    // Stored as chosen: the theme is not rewritten just because this instance
    // won't render it that way today.
    persistTheme(theme);
  }, [theme, experimental]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
