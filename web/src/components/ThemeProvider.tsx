import { type ReactNode, useContext, useEffect, useState } from "react";

import { applyTheme, loadTheme, persistTheme, type Theme, ThemeContext } from "@/lib/theme";

/**
 * ThemeProvider holds the active theme, applies it to the document, and persists
 * it. Anything under it can read/update the theme via useTheme(), so the sidebar
 * toggle and the Theme customizer stay in sync.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
    persistTheme(theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
