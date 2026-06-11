// theme.ts — the customizable theme system.
//
// A "theme" is a small set of base colours (stored as hex, because that's what
// <input type="color"> speaks) plus a mode, font, and animated-background
// choice. Applying a theme writes CSS custom properties on <html>, which the
// Tailwind config consumes via hsl(var(--token)). Everything is derived from a
// handful of base colours so the customizer stays simple while the whole UI
// restyles consistently.
//
// This is the single place that owns colour policy + persistence; components
// talk to it through the ThemeProvider / useTheme below.

import { createContext } from "react";

export type ThemeMode = "light" | "dark";
export type BackgroundEffect =
  | "none"
  | "stars"
  | "constellations"
  | "aurora"
  | "waves"
  | "rain"
  | "dots"
  | "synapse"
  | "perlin"
  | "petals"
  | "sparkles"
  | "embers"
  | "fireflies"
  | "comets";
export type FontChoice = "mono" | "sans";

export interface ThemeColors {
  background: string; // page background
  card: string; // panels / cards ("Panel")
  sidebar: string; // sidebar background
  border: string; // borders / dividers
  foreground: string; // text
  accent: string; // primary accent
}

export interface Theme {
  name: string;
  mode: ThemeMode;
  font: FontChoice;
  colors: ThemeColors;
  background: BackgroundEffect;
  intensity: number; // 0..1 — density/opacity of the background effect
  size: number; // 0..1 — element size of the background effect
  /** 0.1..1 — overall prominence of the effect (CSS opacity on the canvas). */
  bgOpacity: number;
  /** Custom colour for the effect; empty string = follow the accent. */
  bgColor: string;
  /** Frosted-glass surfaces: translucent panels with a backdrop blur. */
  frosted: boolean;
}

// --- colour helpers ---------------------------------------------------------

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / d) % 6;
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** "#rrggbb" → "h s% l%" (the form Tailwind expects inside hsl()). */
export function hexToHslTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

/** Linear blend between two hex colours, t in 0..1. */
function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

/** Pick black or near-white for legible text on top of the given colour. */
function readableOn(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  // Perceived luminance (sRGB-ish).
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0a0a0b" : "#fafafa";
}

// --- harmony generator ------------------------------------------------------

export type Harmony = "complementary" | "analogous" | "triadic" | "monochrome";

/**
 * Generate a full theme from a single accent + mode, choosing background/panel
 * shades and a harmonious accent. A small convenience that mirrors a typical
 * "Generate" button.
 */
export function generateTheme(accent: string, mode: ThemeMode, harmony: Harmony): ThemeColors {
  const { r, g, b } = hexToRgb(accent);
  const hsl = rgbToHsl(r, g, b);
  // Surfaces are tinted by a harmony-rotated hue; the *accent the user picked is
  // preserved* so Generate is deterministic and never drifts the accent on
  // repeated clicks (the old code wrote the rotated hue back as the accent).
  let h = hsl.h;
  if (harmony === "complementary") h = (h + 180) % 360;
  else if (harmony === "analogous") h = (h + 30) % 360;
  else if (harmony === "triadic") h = (h + 120) % 360;
  // monochrome: h stays on the accent's own hue.

  if (mode === "dark") {
    return {
      background: hslToHex(h, 12, 5),
      card: hslToHex(h, 10, 8),
      sidebar: hslToHex(h, 10, 7),
      border: hslToHex(h, 8, 17),
      foreground: "#f5f5f6",
      accent,
    };
  }
  return {
    background: "#ffffff",
    card: hslToHex(h, 30, 99),
    sidebar: hslToHex(h, 20, 97),
    border: hslToHex(h, 15, 90),
    foreground: "#0b0b0d",
    accent,
  };
}

// --- applying a theme -------------------------------------------------------

const FONT_STACKS: Record<FontChoice, string> = {
  mono: 'ui-monospace, "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
};

/** Write a theme to the document as CSS custom properties. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const c = theme.colors;
  const set = (token: string, hex: string) => root.style.setProperty(token, hexToHslTriplet(hex));

  set("--background", c.background);
  set("--foreground", c.foreground);
  set("--card", c.card);
  set("--card-foreground", c.foreground);
  set("--popover", c.card);
  set("--popover-foreground", c.foreground);
  set("--primary", c.accent);
  set("--primary-foreground", readableOn(c.accent));
  set("--secondary", mix(c.card, c.foreground, 0.08));
  set("--secondary-foreground", c.foreground);
  set("--muted", mix(c.card, c.foreground, 0.08));
  set("--muted-foreground", mix(c.foreground, c.background, 0.45));
  set("--accent", c.border);
  set("--accent-foreground", c.foreground);
  set("--border", c.border);
  set("--input", mix(c.border, c.foreground, 0.12));
  set("--ring", c.accent);
  set("--sidebar", c.sidebar);

  root.style.setProperty("--font-app", FONT_STACKS[theme.font]);
  root.classList.toggle("dark", theme.mode === "dark");
  root.classList.toggle("frosted", !!theme.frosted);
  root.style.colorScheme = theme.mode;

  setFavicon(c.accent);
}

/** Recolour the page/tab icon to match the accent (a checkmark on an accent
 *  rounded square), so the favicon tracks the theme to match the theme. */
export function setFavicon(accent: string) {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = accent;
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(4, 4, 56, 56, 16);
    ctx.fill();
  } else {
    ctx.fillRect(4, 4, 56, 56);
  }
  ctx.strokeStyle = readableOn(accent);
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(19, 33);
  ctx.lineTo(28, 43);
  ctx.lineTo(46, 23);
  ctx.stroke();

  // Replace the icon link entirely rather than mutating its href: several
  // browsers won't re-read the favicon when only the href of an existing <link>
  // changes, so the tab colour would lag behind the theme until a reload.
  document.querySelectorAll("link[rel~='icon']").forEach((l) => l.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = canvas.toDataURL("image/png");
  document.head.appendChild(link);
}

// --- presets ----------------------------------------------------------------

function makeTheme(p: Partial<Theme> & { name: string; colors: ThemeColors; mode: ThemeMode }): Theme {
  return {
    font: "mono",
    background: p.mode === "dark" ? "stars" : "none",
    intensity: 0.6,
    size: 0.5,
    bgOpacity: 1,
    bgColor: "", // follow the accent
    frosted: false,
    ...p,
  };
}

export const PRESETS: Theme[] = [
  makeTheme({
    name: "original",
    mode: "dark",
    background: "stars",
    colors: {
      background: "#0c0c0e",
      card: "#131316",
      sidebar: "#0f0f12",
      border: "#26262b",
      foreground: "#f5f5f6",
      accent: "#ec8a9a",
    },
  }),
  makeTheme({
    name: "midnight",
    mode: "dark",
    background: "constellations",
    colors: {
      background: "#0a0e1a",
      card: "#111728",
      sidebar: "#0c1120",
      border: "#202a44",
      foreground: "#eef2ff",
      accent: "#7aa2ff",
    },
  }),
  makeTheme({
    name: "forest",
    mode: "dark",
    background: "aurora",
    colors: {
      background: "#0a120d",
      card: "#101b14",
      sidebar: "#0c1610",
      border: "#1d3326",
      foreground: "#eafff1",
      accent: "#5fd08a",
    },
  }),
  makeTheme({
    name: "paper",
    mode: "light",
    background: "none",
    colors: {
      background: "#faf9f6",
      card: "#ffffff",
      sidebar: "#f1efe9",
      border: "#e3e0d8",
      foreground: "#1a1916",
      accent: "#b4532a",
    },
  }),
  makeTheme({
    name: "light",
    mode: "light",
    background: "none",
    colors: {
      background: "#ffffff",
      card: "#ffffff",
      sidebar: "#f6f6f7",
      border: "#e6e6e8",
      foreground: "#0b0b0d",
      accent: "#d81b60",
    },
  }),
];

export const DEFAULT_THEME = PRESETS[0];

// --- persistence ------------------------------------------------------------

const CURRENT_KEY = "taskrr-theme";
const SAVED_KEY = "taskrr-themes";

export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (raw) return { ...DEFAULT_THEME, ...(JSON.parse(raw) as Theme) };
  } catch {
    // fall through to default
  }
  return DEFAULT_THEME;
}

export function persistTheme(theme: Theme) {
  localStorage.setItem(CURRENT_KEY, JSON.stringify(theme));
}

export function loadSavedThemes(): Theme[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) return JSON.parse(raw) as Theme[];
  } catch {
    // ignore
  }
  return [];
}

export function saveNamedTheme(theme: Theme): Theme[] {
  const others = loadSavedThemes().filter((t) => t.name !== theme.name);
  const next = [...others, theme];
  localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  return next;
}

export function deleteNamedTheme(name: string): Theme[] {
  const next = loadSavedThemes().filter((t) => t.name !== name);
  localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  return next;
}

// --- remembered light/dark themes -------------------------------------------
// The light/dark switch remembers the *whole* theme you had in each mode (e.g.
// "midnight" for dark, a custom one for light) and swaps between them, instead
// of always snapping back to a default preset. Stored per device.

const MODE_KEY = (mode: ThemeMode) => `taskrr-theme-${mode}`;

export function rememberTheme(theme: Theme) {
  try {
    localStorage.setItem(MODE_KEY(theme.mode), JSON.stringify(theme));
  } catch {
    // ignore (private mode / quota)
  }
}

export function loadRememberedTheme(mode: ThemeMode): Theme | null {
  try {
    const raw = localStorage.getItem(MODE_KEY(mode));
    if (raw) return { ...DEFAULT_THEME, ...(JSON.parse(raw) as Theme), mode };
  } catch {
    // ignore
  }
  return null;
}

/** The default theme to fall back to for a mode the user hasn't customised yet. */
export function defaultThemeForMode(mode: ThemeMode): Theme {
  const wanted = mode === "dark" ? "original" : "paper";
  return (
    PRESETS.find((p) => p.mode === mode && p.name === wanted) ??
    PRESETS.find((p) => p.mode === mode) ??
    DEFAULT_THEME
  );
}

/** Flip light↔dark: remember the current theme under its mode, then restore the
 *  remembered (or default) theme for the other mode. */
export function toggledMode(theme: Theme): Theme {
  rememberTheme(theme);
  const target: ThemeMode = theme.mode === "dark" ? "light" : "dark";
  return loadRememberedTheme(target) ?? defaultThemeForMode(target);
}

export const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
} | null>(null);
