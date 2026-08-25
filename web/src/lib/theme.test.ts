import { describe, expect, it } from "vitest";

import { AA_CONTRAST, contrastRatio } from "@/lib/color";
import {
  asPainted,
  EXPERIMENTAL_PRESETS,
  generateTheme,
  mutedForeground,
  PRESETS,
  primaryReadable,
  type ThemeColors,
} from "@/lib/theme";

// The three surfaces text is ever drawn on. Everything else is a tint of one
// of them.
const surfaces = (c: ThemeColors) => [c.background, c.card, c.sidebar].map(asPainted);

// Both sides get rounded on the way into a CSS token, so measure the pair that
// actually gets painted rather than the hex the theme happens to store.
const ratio = (fg: string, bg: string) => contrastRatio(asPainted(fg), bg);

describe("theme contrast", () => {
  // The experimental presets are read the same way as any other, so they are
  // held to the same contrast floor — being behind a switch is not a licence to
  // ship an unreadable theme.
  describe.each([...PRESETS, ...EXPERIMENTAL_PRESETS].map((p) => [p.name, p] as const))("%s", (_name, preset) => {
    it("draws muted text at AA or better on every surface", () => {
      const muted = mutedForeground(preset.colors);
      for (const surface of surfaces(preset.colors)) {
        expect(ratio(muted, surface)).toBeGreaterThanOrEqual(AA_CONTRAST);
      }
    });

    it("draws the accent as text at AA or better on every surface", () => {
      // The one that used to fail: `paper` rendered the active sidebar item's
      // accent text at 4.26:1.
      const readable = primaryReadable(preset.colors);
      for (const surface of surfaces(preset.colors)) {
        expect(ratio(readable, surface)).toBeGreaterThanOrEqual(AA_CONTRAST);
      }
    });

    it("never returns something darker/lighter than it needs to", () => {
      // primaryReadable is for text only, and it should be a no-op wherever the
      // accent already passes — otherwise every theme quietly drifts away from
      // the colour the user picked.
      const readable = primaryReadable(preset.colors);
      const accentPasses = surfaces(preset.colors).every(
        (s) => ratio(preset.colors.accent, s) >= AA_CONTRAST,
      );
      if (accentPasses) expect(readable).toBe(preset.colors.accent);
    });
  });

  it("is doing real work: the raw accent fails where the token passes", () => {
    // Guards against the whole suite above passing vacuously. `paper` is the
    // preset that sent us here — its accent as sidebar text measured 4.26:1.
    const paper = PRESETS.find((p) => p.name === "paper");
    expect(paper).toBeDefined();
    const c = paper!.colors;
    const worst = Math.min(...surfaces(c).map((s) => ratio(c.accent, s)));
    expect(worst).toBeLessThan(AA_CONTRAST);
    expect(primaryReadable(c)).not.toBe(c.accent);
  });

  // A user-chosen accent is not drawn from the presets, so spot-check the
  // awkward ends of the range on a generated theme rather than trusting that
  // the five presets cover it.
  const awkward = ["#ffff00", "#ffffff", "#000000", "#00ff00", "#7f7f7f", "#ec8a9a"];
  describe.each(awkward)("a %s accent", (accent) => {
    it.each(["light", "dark"] as const)("stays readable as text on a %s theme", (mode) => {
      const colors = generateTheme(accent, mode, "complementary");
      const readable = primaryReadable(colors);
      for (const surface of surfaces(colors)) {
        expect(ratio(readable, surface)).toBeGreaterThanOrEqual(AA_CONTRAST);
      }
    });
  });
});

describe("interface styles", () => {
  it("keeps the ordinary presets on the soft style", () => {
    // A preset that quietly shipped `flat` would restyle the whole app for
    // someone who only picked a colour scheme.
    for (const p of PRESETS) expect(p.style ?? "soft").toBe("soft");
  });

  it("marks every experimental preset as flat", () => {
    // The reason these are gated at all: they change the shape of everything.
    // One that isn't flat has no business being behind the switch.
    expect(EXPERIMENTAL_PRESETS.length).toBeGreaterThan(0);
    for (const p of EXPERIMENTAL_PRESETS) expect(p.style).toBe("flat");
  });
});
