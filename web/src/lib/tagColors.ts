// tagColors.ts — an optional colour per tag.
//
// Tags were all one colour, which is fine for three of them and useless for
// twenty. A colour is stored only for the tags someone actually picked one for;
// everything else keeps the neutral chip, so a list nobody has customised looks
// exactly as it did.
//
// Matching is case-insensitive, because "Home" and "home" are the same tag
// everywhere else in the app (quick add and the CSV importer both de-duplicate
// that way) and a colour that depended on capitalisation would be a bug.
//
// Pure and React-free, so the rules are testable (tagColors.test.ts).

import { ensureContrast } from "./color";

/** Stored as { lowercased tag: hex }. */
export type TagColors = Record<string, string>;

/** The colour chosen for a tag, or null to use the default chip. */
export function tagColor(colors: TagColors | undefined, tag: string): string | null {
  if (!colors) return null;
  const hex = colors[tag.trim().toLowerCase()];
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
}

/** Set (or clear, with null) a tag's colour, keeping the map lowercased. */
export function setTagColor(colors: TagColors | undefined, tag: string, hex: string | null): TagColors {
  const next = { ...(colors ?? {}) };
  const key = tag.trim().toLowerCase();
  if (!key) return next;
  if (hex == null || hex === "") delete next[key];
  else next[key] = hex.toLowerCase();
  return next;
}

/**
 * How to paint a tag chip: a translucent wash of its colour, with text nudged
 * to stay readable on the surface the chip sits on.
 *
 * The wash rather than a solid fill because a row of solid chips fights the
 * staleness colour the card is already using to mean something.
 */
export function tagChipStyle(hex: string, surface: string): { backgroundColor: string; color: string } {
  return { backgroundColor: `${hex}26`, color: ensureContrast(hex, surface) };
}

/** Drop colours for tags nothing uses any more, so the map can't grow forever. */
export function pruneTagColors(colors: TagColors | undefined, inUse: string[]): TagColors {
  if (!colors) return {};
  const live = new Set(inUse.map((t) => t.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(colors).filter(([k]) => live.has(k)));
}
