// prefs.tsx — small, client-side user preferences.
//
// These are browser-local (localStorage) for now. When per-user accounts land
// in Phase 2 we'll persist them server-side against the account; keeping every
// read/write behind usePrefs()/PrefsProvider means components won't change when
// that happens. (This is also where the 12/24h clock choice moves to once there
// are users — it's just another field here.)

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { installSmoothWheel } from "@/lib/smoothScroll";

export type ColorPickerStyle = "wheel" | "native";
export type AddButtonPosition = "top" | "bottom";
export type CardSize = "comfortable" | "compact";

export interface Prefs {
  /** 12- vs 24-hour time display. */
  hour12: boolean;
  /** Default colours for the two ends of the task staleness gradient. */
  taskColorFresh: string;
  taskColorOverdue: string;
  /** A task with no cadence fades fresh→overdue over this many days. */
  noRoutineFadeDays: number;
  /** Which colour picker to use: the built-in wheel or the OS-native input. */
  colorPicker: ColorPickerStyle;
  /** Where the mobile "add task" button lives. */
  addButton: AddButtonPosition;

  // --- layout ---
  /** Task card density. */
  cardSize: CardSize;
  /** Fixed number of task columns, or 0 for the responsive default. */
  taskColumns: number;
  /** Show the calendar / activity-chart side panels. */
  showCalendar: boolean;
  showActivity: boolean;

  // --- motion ---
  /** Master switch for background + UI animations. */
  animations: boolean;
  /** Animation speed multiplier (0.25–2). */
  animationSpeed: number;
  /** Granular switches (all subordinate to `animations`): each one turns a
   *  single class of motion off while the rest keep animating. */
  /** Task cards gliding to new positions + entrance fade. */
  animGrid: boolean;
  /** Action feedback: quick-log pulse, count pops, button press-down. */
  animFeedback: boolean;
  /** The sliding highlight behind selected tabs / days / nav items. */
  animIndicators: boolean;
  /** Floating windows + dialogs opening, closing, minimising. */
  animWindows: boolean;
  /** View transitions: header crossfade, calendar month slide, list entrances. */
  animViews: boolean;
  /** Eased mouse-wheel scrolling (rAF-driven, so it interpolates at the
   *  display's refresh rate). Touchpads/touch keep native scrolling. */
  smoothScroll: boolean;

  // --- windows ---
  /** Whether floating windows can be dragged/resized. Off = static panels. */
  draggableWindows: boolean;
  /** Pause the animated background while dragging/resizing a window (keeps a
   *  frosted window's blur cheap on weaker devices). */
  pauseBgOnDrag: boolean;
  /** Remembered window sizes (px), keyed by window id, so a window reopens at
   *  the size you last left it. */
  windowSizes: Record<string, WindowSize>;
}

/** A remembered floating-window size. */
export interface WindowSize {
  w: number;
  h: number;
}

/** Best-effort guess of whether the user's locale uses a 12-hour clock. */
export function localeHour12(): boolean {
  try {
    const opts = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions();
    if (typeof opts.hour12 === "boolean") return opts.hour12;
    const cycle = (opts as { hourCycle?: string }).hourCycle;
    if (cycle) return cycle === "h11" || cycle === "h12";
  } catch {
    // Intl unavailable — fall through.
  }
  return true;
}

function defaults(): Prefs {
  return {
    hour12: localeHour12(),
    taskColorFresh: "#22c55e", // emerald
    taskColorOverdue: "#ef4444", // red
    noRoutineFadeDays: 7,
    colorPicker: "wheel",
    addButton: "top",
    cardSize: "comfortable",
    taskColumns: 0,
    showCalendar: true,
    showActivity: true,
    animations: true,
    animationSpeed: 1,
    animGrid: true,
    animFeedback: true,
    animIndicators: true,
    animWindows: true,
    animViews: true,
    smoothScroll: true,
    draggableWindows: true,
    pauseBgOnDrag: true,
    windowSizes: {},
  };
}

const KEY = "taskrr-prefs";
const LEGACY_HOUR12 = "taskrr-hour12";

function load(): Prefs {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Prefs>) };
    // Migrate the old standalone 12/24h key if present.
    const legacy = localStorage.getItem(LEGACY_HOUR12);
    if (legacy === "12") return { ...base, hour12: true };
    if (legacy === "24") return { ...base, hour12: false };
  } catch {
    // ignore and use defaults
  }
  return base;
}

const Ctx = createContext<{ prefs: Prefs; setPrefs: (p: Partial<Prefs>) => void } | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setState] = useState<Prefs>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  }, [prefs]);

  // When animations are off, neutralise CSS animations/transitions app-wide.
  // The granular switches set their own classes for the few cases that are
  // CSS-driven (button press scale, dialog open/close); everything else reads
  // the pref directly in its component.
  useEffect(() => {
    const root = document.documentElement.classList;
    root.toggle("no-animations", !prefs.animations);
    root.toggle("no-anim-feedback", !prefs.animFeedback);
    root.toggle("no-anim-windows", !prefs.animWindows);
  }, [prefs.animations, prefs.animFeedback, prefs.animWindows]);

  // Eased mouse-wheel scrolling (see lib/smoothScroll). Installed app-wide so
  // the login page scrolls the same way as the app.
  useEffect(() => {
    if (!prefs.smoothScroll) return;
    return installSmoothWheel();
  }, [prefs.smoothScroll]);

  const setPrefs = useCallback((p: Partial<Prefs>) => setState((cur) => ({ ...cur, ...p })), []);
  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePrefs must be used within a PrefsProvider");
  return c;
}

/**
 * Remove all of Taskrr's locally-cached UI preferences (theme, layout, recent
 * colours, …). Called on logout for tidiness on shared browsers — these are
 * non-sensitive, and the signed-in copy lives server-side per account anyway.
 * Only our own `taskrr-` keys are touched.
 */
export function clearStoredPreferences() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("taskrr-")) localStorage.removeItem(key);
    }
  } catch {
    // ignore (storage disabled / private mode)
  }
}
