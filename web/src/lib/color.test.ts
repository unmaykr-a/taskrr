import { describe, expect, it } from "vitest";

import { AA_CONTRAST, contrastRatio, ensureContrast, relativeLuminance } from "@/lib/color";
import { NEUTRAL_COLOR } from "@/lib/staleness";

const WHITE_CARD = "#ffffff";
const DARK_CARD = "#131316";

describe("relativeLuminance", () => {
  it("spans the full range for black and white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("accepts shorthand hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#4488cc", "#4488cc")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#123456", "#fedcba")).toBeCloseTo(contrastRatio("#fedcba", "#123456"), 10);
  });
});

describe("ensureContrast", () => {
  it("leaves a colour alone when it already clears the threshold", () => {
    // Dark themes were already fine, so their tints must come through untouched.
    const rose = "#ec8a9a";
    expect(contrastRatio(rose, DARK_CARD)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(ensureContrast(rose, DARK_CARD)).toBe(rose);
  });

  it("darkens a pale colour until it reads on a white panel", () => {
    // The staleness tints that motivated this: all sat near 2.5-3:1 on a white
    // card, which is what made light themes hard to read.
    for (const tint of [NEUTRAL_COLOR, "#fb7185", "#22c55e", "#f59e0b"]) {
      expect(contrastRatio(tint, WHITE_CARD)).toBeLessThan(AA_CONTRAST);
      const fixed = ensureContrast(tint, WHITE_CARD);
      expect(contrastRatio(fixed, WHITE_CARD)).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it("lightens rather than darkens when the surface is dark", () => {
    const muddy = "#2a2a2e";
    const fixed = ensureContrast(muddy, DARK_CARD);
    expect(relativeLuminance(fixed)).toBeGreaterThan(relativeLuminance(muddy));
    expect(contrastRatio(fixed, DARK_CARD)).toBeGreaterThanOrEqual(AA_CONTRAST);
  });

  it("moves as little as it has to", () => {
    // A colour just under the line should end up near it, not slammed to black.
    const fixed = ensureContrast("#ef4444", WHITE_CARD);
    expect(contrastRatio(fixed, WHITE_CARD)).toBeGreaterThanOrEqual(AA_CONTRAST);
    expect(contrastRatio(fixed, WHITE_CARD)).toBeLessThan(AA_CONTRAST + 0.5);
  });

  it("keeps the hue recognisable rather than going neutral", () => {
    // "Due soon" must still look amber after the adjustment.
    const { r, g, b } = hex(ensureContrast("#f59e0b", WHITE_CARD));
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it("returns the best available colour when the target is unreachable", () => {
    // A mid-grey surface has no room for 7:1 in either direction (neither pure
    // white nor pure black gets there), so the closest end of the scale wins
    // rather than the search returning something worse.
    const surface = "#808080";
    expect(contrastRatio("#ffffff", surface)).toBeLessThan(7);
    expect(contrastRatio("#000000", surface)).toBeLessThan(7);
    expect(["#ffffff", "#000000"]).toContain(ensureContrast("#4d7fbf", surface, 7));
  });

  it("honours a custom target", () => {
    const fixed = ensureContrast("#a1a1aa", WHITE_CARD, 7);
    expect(contrastRatio(fixed, WHITE_CARD)).toBeGreaterThanOrEqual(7);
  });
});

function hex(s: string) {
  return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16) };
}
