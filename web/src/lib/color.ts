// color.ts — small, dependency-free colour maths shared by the staleness
// gradient and the built-in colour picker. Pure functions (hex in, hex out),
// so they're trivial to test and reuse.

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h || "000000", 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Linear blend between two hex colours; t in 0..1. */
export function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const k = clamp(t, 0, 1);
  return rgbToHex(x.r + (y.r - x.r) * k, x.g + (y.g - x.g) * k, x.b + (y.b - x.b) * k);
}

/** True for a well-formed "#rgb" / "#rrggbb" string. */
export function isHex(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s.trim());
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function hexToHsv(hex: string): HSV {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

// --- contrast -----------------------------------------------------------------
// The theme lets people pick any colours they like, and the staleness gradient
// paints small labels in a colour that slides from "fresh" to "overdue". Both
// can land on combinations that are technically pretty but hard to read, so
// these helpers measure real contrast (WCAG 2.1) and nudge a colour until it
// clears a threshold — keeping its hue, only moving how light it is.

/** WCAG relative luminance of a hex colour (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two hex colours, 1 (identical) to 21 (b/w). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** AA threshold for normal-size body text. */
export const AA_CONTRAST = 4.5;

/**
 * Return `color` if it already reads clearly on `surface`, otherwise the
 * closest version of it that does — blended toward black or white, whichever
 * the surface has room for, by the smallest amount that reaches `target`.
 *
 * Blending toward a neutral keeps the hue and only trades away some
 * saturation, so an amber "due soon" stays recognisably amber; it just stops
 * being pale amber on a white card. When even pure black/white can't reach the
 * target (a mid-grey surface), the best available colour is returned rather
 * than failing.
 */
export function ensureContrast(color: string, surface: string, target: number = AA_CONTRAST): string {
  if (contrastRatio(color, surface) >= target) return color;

  // Head for whichever end of the scale the surface leaves the most room for.
  const toward = contrastRatio("#ffffff", surface) >= contrastRatio("#000000", surface) ? "#ffffff" : "#000000";
  if (contrastRatio(toward, surface) < target) return toward; // unreachable target

  // Binary-search the lightest touch that clears the threshold, so the colour
  // moves as little as it has to.
  let lo = 0;
  let hi = 1;
  let best = toward;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const candidate = mixHex(color, toward, mid);
    if (contrastRatio(candidate, surface) >= target) {
      best = candidate;
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return best;
}

/** Black or near-white, whichever is more legible on top of `hex`. */
export function readableOn(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? "#0a0a0b" : "#fafafa";
}

// --- recently-used colours (localStorage) -----------------------------------

const RECENT_KEY = "taskrr-recent-colors";

export function getRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    // ignore
  }
  return [];
}

/** Record a colour as recently used (most-recent first, de-duped, max 10). */
export function pushRecentColor(hex: string): string[] {
  const h = hex.toLowerCase();
  const next = [h, ...getRecentColors().filter((c) => c.toLowerCase() !== h)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
