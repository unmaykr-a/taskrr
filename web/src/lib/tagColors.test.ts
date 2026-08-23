import { describe, expect, it } from "vitest";

import { AA_CONTRAST, contrastRatio } from "@/lib/color";
import { pruneTagColors, setTagColor, tagChipStyle, tagColor } from "@/lib/tagColors";

describe("tagColor", () => {
  it("is null until a colour is chosen", () => {
    expect(tagColor(undefined, "home")).toBeNull();
    expect(tagColor({}, "home")).toBeNull();
  });

  it("ignores capitalisation, the way tags do everywhere else", () => {
    const colors = { home: "#ff0000" };
    expect(tagColor(colors, "Home")).toBe("#ff0000");
    expect(tagColor(colors, "  HOME  ")).toBe("#ff0000");
  });

  it("refuses anything that isn't a hex colour", () => {
    // The map is user data synced from prefs, so it can contain junk.
    expect(tagColor({ home: "red" }, "home")).toBeNull();
    expect(tagColor({ home: "" }, "home")).toBeNull();
    expect(tagColor({ home: "#fff" }, "home")).toBeNull();
  });
});

describe("setTagColor", () => {
  it("stores lowercased", () => {
    expect(setTagColor({}, "Home", "#AABBCC")).toEqual({ home: "#aabbcc" });
  });

  it("clears rather than storing an empty value", () => {
    expect(setTagColor({ home: "#aabbcc" }, "home", null)).toEqual({});
    expect(setTagColor({ home: "#aabbcc" }, "home", "")).toEqual({});
  });

  it("leaves other tags alone", () => {
    expect(setTagColor({ a: "#111111" }, "b", "#222222")).toEqual({ a: "#111111", b: "#222222" });
  });

  it("ignores a blank tag", () => {
    expect(setTagColor({}, "   ", "#aabbcc")).toEqual({});
  });
});

describe("tagChipStyle", () => {
  it("keeps the label readable on the surface", () => {
    // The whole point: a pale tag colour must not become unreadable text.
    for (const hex of ["#ffff00", "#ffffff", "#000000", "#5fd08a"]) {
      const { color } = tagChipStyle(hex, "#ffffff");
      expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(AA_CONTRAST);
    }
  });

  it("washes the background rather than filling it", () => {
    expect(tagChipStyle("#ff0000", "#ffffff").backgroundColor).toBe("#ff000026");
  });
});

describe("pruneTagColors", () => {
  it("drops colours for tags nothing uses", () => {
    expect(pruneTagColors({ home: "#111111", gone: "#222222" }, ["Home"])).toEqual({ home: "#111111" });
  });
  it("copes with nothing stored", () => {
    expect(pruneTagColors(undefined, ["home"])).toEqual({});
  });
});
