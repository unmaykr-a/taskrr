import { describe, expect, it } from "vitest";

import {
  checkKey,
  describeKey,
  pruneOverrides,
  resolveAll,
  resolveKey,
  SHORTCUT_ACTIONS,
} from "@/lib/shortcuts";

describe("resolveKey", () => {
  it("falls back to the default when nothing is overridden", () => {
    expect(resolveKey(undefined, "new")).toBe("n");
    expect(resolveKey({}, "search")).toBe("/");
  });

  it("prefers the user's key", () => {
    expect(resolveKey({ new: "t" }, "new")).toBe("t");
  });

  it("ignores an empty override rather than binding nothing", () => {
    expect(resolveKey({ new: "" }, "new")).toBe("n");
    expect(resolveKey({ new: "  " }, "new")).toBe("n");
  });

  it("returns nothing for an action that no longer exists", () => {
    // A stored override for a removed action shouldn't resurrect it.
    expect(resolveKey({ ancient: "z" }, "ancient")).toBe("");
  });

  it("resolves the whole set", () => {
    expect(resolveAll({ new: "t" })).toEqual({ new: "t", search: "/", help: "?", clear: "Escape" });
  });
});

describe("checkKey", () => {
  it("accepts an ordinary letter", () => {
    expect(checkKey("t", "new", {})).toBeNull();
  });

  it("refuses a modifier pressed on its own", () => {
    for (const k of ["Shift", "Control", "Alt", "Meta"]) {
      expect(checkKey(k, "new", {})?.problem).toBe("modifier");
    }
  });

  it("refuses the digits, which belong to the view switcher", () => {
    expect(checkKey("1", "new", {})?.problem).toBe("reserved");
    expect(checkKey("9", "new", {})?.problem).toBe("reserved");
  });

  it("refuses a named key that wouldn't read as a shortcut", () => {
    expect(checkKey("F5", "new", {})?.problem).toBe("unprintable");
    expect(checkKey("PageDown", "new", {})?.problem).toBe("unprintable");
    expect(checkKey("", "new", {})?.problem).toBe("unprintable");
  });

  it("allows the few named keys that do", () => {
    // Escape is Clear's own default, so ask about it as Clear; asking as New
    // correctly reports it taken, which the clash test below covers.
    expect(checkKey("Escape", "clear", {})).toBeNull();
    expect(checkKey(" ", "new", {})).toBeNull();
    expect(checkKey("Escape", "new", {})?.problem).toBe("taken");
  });

  it("refuses a key another action already has, and says which", () => {
    const got = checkKey("/", "new", {});
    expect(got?.problem).toBe("taken");
    expect(got?.takenBy).toBe("Search tasks");
  });

  it("sees a clash against an override, not just a default", () => {
    // "t" isn't anyone's default, but it is bound here.
    const got = checkKey("t", "new", { search: "t" });
    expect(got?.problem).toBe("taken");
    expect(got?.takenBy).toBe("Search tasks");
  });

  it("lets an action keep the key it already has", () => {
    expect(checkKey("n", "new", {})).toBeNull();
    expect(checkKey("t", "new", { new: "t" })).toBeNull();
  });

  it("frees a default once its owner has moved off it", () => {
    // search moved to "t", so "/" is available to new.
    expect(checkKey("/", "new", { search: "t" })).toBeNull();
  });
});

describe("describeKey", () => {
  it("names the keys that have no glyph", () => {
    expect(describeKey(" ")).toBe("Space");
    expect(describeKey("Escape")).toBe("Esc");
  });
  it("leaves an ordinary key alone", () => {
    expect(describeKey("n")).toBe("n");
  });
});

describe("pruneOverrides", () => {
  it("keeps only what actually differs from the default", () => {
    expect(pruneOverrides({ new: "n", search: "t" })).toEqual({ search: "t" });
  });

  it("drops overrides for actions that no longer exist", () => {
    expect(pruneOverrides({ ancient: "z" })).toEqual({});
  });

  it("is empty when everything is default", () => {
    const all = Object.fromEntries(SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultKey]));
    expect(pruneOverrides(all)).toEqual({});
  });
});
