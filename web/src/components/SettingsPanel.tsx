import { useRef, useState } from "react";
import { Palette, Shield, SlidersHorizontal, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { useAuth } from "@/components/AuthProvider";
import { AccountSection } from "@/components/settings/AccountSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { ThemeCustomizer } from "@/components/settings/ThemeCustomizer";
import { AdminPanel } from "@/components/AdminPanel";

type Section = "account" | "preferences" | "theme" | "admin";

/**
 * SettingsPanel is the unified settings window body: a left nav with sections
 * (Account, Preferences, Theme, and — for admins — Admin), replacing the old
 * separate Admin / Theme / light-dark sidebar buttons.
 */
export function SettingsPanel({ initial = "account" }: { initial?: Section }) {
  const { user } = useAuth();
  const [section, setSection] = useState<Section>(initial);
  const navRef = useRef<HTMLElement>(null);

  const items: { id: Section; label: string; icon: typeof User; adminOnly?: boolean }[] = [
    { id: "account", label: "Account", icon: User },
    { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
    { id: "theme", label: "Theme", icon: Palette },
    { id: "admin", label: "Admin", icon: Shield, adminOnly: true },
  ];
  const visible = items.filter((i) => !i.adminOnly || user?.role === "admin");
  const active = visible.some((i) => i.id === section) ? section : "account";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
      {/* Phone: a horizontal tab strip across the top (the window is full-screen,
          so this frees the whole width for content). Desktop: a vertical side nav. */}
      <nav
        ref={navRef}
        className="relative flex shrink-0 gap-1 overflow-x-auto border-b pb-2 sm:sticky sm:top-0 sm:w-32 sm:flex-col sm:self-start sm:overflow-visible sm:border-b-0 sm:pb-0"
      >
        {/* The active background is a bubble that slides between nav items
            (works in both the phone row and desktop column orientation). */}
        <SlidingHighlight containerRef={navRef} activeKey={active} className="rounded-md bg-primary/15" />
        {visible.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.id}
              data-slide-key={it.id}
              type="button"
              onClick={() => setSection(it.id)}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors sm:flex-none sm:justify-start",
                active === it.id
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{it.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 sm:border-l sm:pl-4">
        {active === "account" && <AccountSection />}
        {active === "preferences" && <PreferencesSection />}
        {active === "theme" && <ThemeCustomizer />}
        {active === "admin" && <AdminPanel />}
      </div>
    </div>
  );
}
