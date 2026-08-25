import { useRef, useState } from "react";
import { Keyboard, Palette, Shield, SlidersHorizontal, User } from "lucide-react";

import { currentRelease, formatReleaseDate } from "@/lib/releases";
import { useAppLayout } from "@/lib/useAppLayout";
import { cn } from "@/lib/utils";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { SlidingHighlight } from "@/components/ui/SlidingHighlight";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { AccountSection } from "@/components/settings/AccountSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { ShortcutsSection } from "@/components/settings/ShortcutsSection";
import { ThemeCustomizer } from "@/components/settings/ThemeCustomizer";
import { AdminPanel } from "@/components/AdminPanel";

declare const __APP_VERSION__: string;

/**
 * How the settings window opens, in one place so every way in agrees.
 *
 * The height matters: the pane keeps its nav column and the rule beside it
 * still while the section scrolls, and it can only do that if it has a height
 * to fill. Without one the window sizes to its content and the whole thing —
 * nav, divider and all — scrolls as a single sheet.
 */
export const SETTINGS_WINDOW = { title: "Settings", width: 640, height: 560 };

type Section = "account" | "preferences" | "shortcuts" | "theme" | "admin";

/**
 * SettingsPanel is the unified settings window body: a left nav with sections
 * (Account, Preferences, Theme, and — for admins — Admin), replacing the old
 * separate Admin / Theme / light-dark sidebar buttons.
 */
export function SettingsPanel({ initial = "account" }: { initial?: Section }) {
  const { user } = useAuth();
  const { prefs } = usePrefs();
  const [section, setSection] = useState<Section>(initial);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const release = currentRelease();
  // The version (and the changelog behind it) normally lives in the sidebar's
  // footer. The layouts without one need it somewhere, and the foot of this
  // window's nav is where you'd look for an "about" line.
  const layout = useAppLayout();

  const items: {
    id: Section;
    label: string;
    icon: typeof User;
    adminOnly?: boolean;
    hidden?: boolean;
  }[] = [
    { id: "account", label: "Account", icon: User },
    { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
    // Only worth a page of its own when the shortcuts are actually running;
    // otherwise it would offer to configure something switched off.
    { id: "shortcuts", label: "Shortcuts", icon: Keyboard, hidden: !prefs.keyboardShortcuts },
    { id: "theme", label: "Theme", icon: Palette },
    { id: "admin", label: "Admin", icon: Shield, adminOnly: true },
  ];
  const visible = items.filter((i) => !i.hidden && (!i.adminOnly || user?.role === "admin"));
  const active = visible.some((i) => i.id === section) ? section : "account";

  return (
    // The layout responds to the window's width, not the screen's — see
    // .settings-shell in index.css. A narrow window gets the tab strip a phone
    // gets, rather than a side nav squeezing the content to a column of
    // single-word lines.
    <div className="settings-shell min-h-full">
      <nav ref={navRef} className="settings-nav">
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
                "relative flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors",
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
        {layout !== "sidebar" && (
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            title={release ? `Released ${formatReleaseDate(release.date)}` : undefined}
            className="settings-version shrink-0 px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            v{__APP_VERSION__}
          </button>
        )}
      </nav>
      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />

      <div className="settings-body">
        {active === "account" && <AccountSection />}
        {active === "preferences" && <PreferencesSection />}
        {active === "shortcuts" && <ShortcutsSection />}
        {active === "theme" && <ThemeCustomizer />}
        {active === "admin" && <AdminPanel />}
      </div>
    </div>
  );
}
