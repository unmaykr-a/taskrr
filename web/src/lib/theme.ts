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

import { AA_CONTRAST, contrastRatio, ensureContrast } from "./color";

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
/**
 * How the interface is *shaped*, as opposed to coloured.
 *
 * "soft" is the app as it has always looked: generous corner radii, shadowed
 * panels, optional frosted glass. "flat" squares everything off and drops the
 * depth cues, which is what most self-hosted dashboards look like — and is
 * easier on the eye if Taskrr sits in a browser tab beside them all day.
 *
 * Experimental: it restyles every element rather than recolouring them, so the
 * flat styles are only offered when the operator opted in (TASKRR_EXPERIMENTAL).
 */
export type ThemeStyle = "soft" | "flat";

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
  /** Interface shape. Absent on themes saved before this existed, which is
   *  exactly the "soft" they were built with. */
  style?: ThemeStyle;
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

/**
 * The colour a surface actually ends up being on screen.
 *
 * Tokens are written as rounded "h s% l%" triplets, so what gets painted is a
 * shade or two off the hex the theme stores. That is invisible to the eye but
 * not to a contrast check: measuring against the stored hex can clear 4.5:1 by
 * a hair while the painted surface sits just under it. Round-trip through the
 * same rounding the token write does, and the check matches what is rendered.
 */
export function asPainted(hex: string): string {
  const [h, s, l] = hexToHslTriplet(hex).split(" ");
  return hslToHex(parseFloat(h), parseFloat(s), parseFloat(l));
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

/**
 * Secondary text: a softened foreground that still has to be readable.
 *
 * Blending the text colour 45% toward the page background is the obvious way to
 * "dim" it, and it behaves well in dark themes — bright text dimmed against a
 * dark surface keeps plenty of separation. In light themes the same blend runs
 * the wrong way: dark text lightened against an already-light surface landed
 * around 3.5:1, below the 4.5:1 needed for body text, which put every timestamp,
 * description, and sidebar count under the threshold at once.
 *
 * So dim first, then pull back toward the foreground until the result clears AA
 * on every surface muted text actually sits on (page, panel, sidebar). Dark
 * themes already pass and come through untouched.
 */
export function mutedForeground(c: ThemeColors): string {
  const surfaces = [c.background, c.card, c.sidebar].map(asPainted);
  let muted = mix(c.foreground, c.background, 0.45);

  // Both sides of the comparison get rounded on their way into a token, so
  // hitting 4.5:1 on paper can still land at 4.43:1 on screen. Aim at the
  // target, look at what actually gets painted, and aim a little higher until
  // the rendered pair clears it — a couple of passes at most.
  for (let attempt = 0; attempt < 6; attempt++) {
    const target = AA_CONTRAST + attempt * 0.1;
    for (const surface of surfaces) muted = ensureContrast(muted, surface, target);
    const painted = asPainted(muted);
    if (surfaces.every((s) => contrastRatio(painted, s) >= AA_CONTRAST)) break;
  }
  return muted;
}

/**
 * The accent, made safe to use as text.
 *
 * `bg-primary` paints the accent as a block with `--primary-foreground` on top,
 * and that pair is checked already. Drawing the same accent as *text* on a
 * plain surface is the other problem, and it was the last place the app fell
 * short: the `paper` preset's active sidebar item rendered a user-chosen accent
 * at 4.26:1 against the sidebar.
 *
 * Same approach as mutedForeground: aim at AA on every surface the accent gets
 * drawn on, then check what actually gets painted and aim higher if rounding
 * cost us the last tenth. A dark accent on a dark theme usually passes already
 * and comes back untouched.
 */
export function primaryReadable(c: ThemeColors): string {
  const surfaces = [c.background, c.card, c.sidebar].map(asPainted);
  let readable = c.accent;
  for (let attempt = 0; attempt < 6; attempt++) {
    const target = AA_CONTRAST + attempt * 0.1;
    for (const surface of surfaces) readable = ensureContrast(readable, surface, target);
    const painted = asPainted(readable);
    if (surfaces.every((s) => contrastRatio(painted, s) >= AA_CONTRAST)) break;
  }
  return readable;
}

/**
 * Resolve which interface shape actually gets rendered.
 *
 * Three inputs, in order: the flat styles only exist on an instance that opted
 * in, then whatever the theme says, then whatever the admin set as the instance
 * default. A theme with no style of its own follows the instance, which is what
 * lets an admin restyle the login page and every account that hasn't chosen.
 */
export function resolveStyle(
  theme: Theme,
  instance: string | undefined,
  experimental: boolean,
): ThemeStyle {
  if (!experimental) return "soft";
  if (theme.style === "soft" || theme.style === "flat") return theme.style;
  return instance === "flat" ? "flat" : "soft";
}

/** Write a theme to the document as CSS custom properties. The style is passed
 *  in rather than read off the theme, because it is resolved against the
 *  instance's own setting (see resolveStyle). */
export function applyTheme(theme: Theme, style: ThemeStyle = "soft") {
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
  set("--primary-readable", primaryReadable(c));
  set("--secondary", mix(c.card, c.foreground, 0.08));
  set("--secondary-foreground", c.foreground);
  set("--muted", mix(c.card, c.foreground, 0.08));
  set("--muted-foreground", mutedForeground(c));
  set("--accent", c.border);
  set("--accent-foreground", c.foreground);
  set("--border", c.border);
  set("--input", mix(c.border, c.foreground, 0.12));
  set("--ring", c.accent);
  set("--sidebar", c.sidebar);

  root.style.setProperty("--font-app", FONT_STACKS[theme.font]);
  root.classList.toggle("dark", theme.mode === "dark");
  root.classList.toggle("frosted", !!theme.frosted);
  // The shape of everything: one class, and index.css does the rest. Flat wins
  // over frosted where they disagree — a flat theme with blurred glass panels
  // would be neither thing.
  root.classList.toggle("style-flat", style === "flat");
  root.style.colorScheme = theme.mode;

  setFavicon(c.accent);
}

/** Recolour the page/tab icon to match the accent (a checkmark on an accent
 *  rounded square), so the favicon tracks the theme — unless a custom branding
 *  icon has been set, which then wins. */
let lastAccent = "#ec8a9a";
let brandIcon: string | null = null;

/** Set (or clear) the custom branding favicon (a data URL). When set it
 *  overrides the generated checkmark; pass "" / null to fall back to it. */
export function setBrandIcon(icon: string | null) {
  brandIcon = icon && icon.trim() !== "" ? icon : null;
  setFavicon(lastAccent); // re-render with the new choice
}

export function setFavicon(accent: string) {
  if (typeof document === "undefined") return;
  lastAccent = accent;

  // A custom branding icon wins: point the favicon straight at its data URL.
  if (brandIcon) {
    document.querySelectorAll("link[rel~='icon']").forEach((l) => l.remove());
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = brandIcon;
    document.head.appendChild(link);
    return;
  }

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
    // No style: an ordinary preset is a set of colours, and the shape it gets
    // is whatever the instance is set to.
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

/**
 * The flat presets, offered only on an instance that opted in to experimental
 * features. Deliberately plain: greys, one accent, no effect, a sans face —
 * the point is the shape, not another palette.
 */
export const EXPERIMENTAL_PRESETS: Theme[] = [
  makeTheme({
    name: "general",
    mode: "dark",
    style: "flat",
    font: "sans",
    background: "none",
    colors: {
      background: "#1b1f22",
      card: "#22272b",
      sidebar: "#191d20",
      border: "#333a3f",
      foreground: "#e8ebed",
      accent: "#4b8fd6",
    },
  }),
  makeTheme({
    name: "general light",
    mode: "light",
    style: "flat",
    font: "sans",
    background: "none",
    colors: {
      background: "#f4f5f7",
      card: "#ffffff",
      sidebar: "#eceef1",
      border: "#d3d7dd",
      foreground: "#1c1f23",
      accent: "#2f6fb5",
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
