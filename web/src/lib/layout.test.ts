import { describe, expect, it } from "vitest";

import { APP_LAYOUTS, resolveLayout, navColumnWidth, SIDEBAR_WIDTH, RAIL_WIDTH } from "@/lib/layout";

describe("resolveLayout", () => {
  it("only ever gives the sidebar without the experimental switch", () => {
    // The point of the switch: an account (or an admin) that picked a layout
    // keeps the choice stored, but an instance that never opted in renders the
    // one arrangement it has always had.
    expect(resolveLayout("topbar", "rail", false)).toBe("sidebar");
  });

  it("prefers the account's own choice", () => {
    expect(resolveLayout("rail", "topbar", true)).toBe("rail");
  });

  it("falls back to the instance's when the account hasn't picked", () => {
    expect(resolveLayout("", "topbar", true)).toBe("topbar");
    expect(resolveLayout(undefined, "rail", true)).toBe("rail");
  });

  it("falls back to the sidebar when neither has", () => {
    expect(resolveLayout("", "", true)).toBe("sidebar");
    expect(resolveLayout(undefined, undefined, true)).toBe("sidebar");
  });

  it("ignores a value it doesn't know", () => {
    // These arrive from stored preferences and from a settings row, so an old
    // or hand-edited value must land on something that renders rather than on
    // nothing at all.
    expect(resolveLayout("carousel", "", true)).toBe("sidebar");
    expect(resolveLayout("carousel", "rail", true)).toBe("rail");
  });

  it("offers every layout it can resolve", () => {
    for (const l of APP_LAYOUTS) expect(resolveLayout(l.value, "", true)).toBe(l.value);
  });
});

describe("navColumnWidth", () => {
  const wide = { compact: false, collapsed: false };

  it("measures the column each layout actually puts down the left", () => {
    expect(navColumnWidth("sidebar", wide)).toBe(SIDEBAR_WIDTH);
    expect(navColumnWidth("rail", wide)).toBe(RAIL_WIDTH);
    expect(navColumnWidth("topbar", wide)).toBe(0);
  });

  it("gives back the width when the sidebar is folded away", () => {
    expect(navColumnWidth("sidebar", { compact: false, collapsed: true })).toBe(0);
  });

  it("gives back the width when the sidebar is a drawer", () => {
    // Compact, the sidebar floats over the page instead of displacing it, so
    // nothing lines up against it.
    expect(navColumnWidth("sidebar", { compact: true, collapsed: false })).toBe(0);
  });

  it("keeps the rail's width on a phone, where it stays a real column", () => {
    expect(navColumnWidth("rail", { compact: true, collapsed: false })).toBe(RAIL_WIDTH);
    // Folding is a sidebar idea; the rail is already the folded one.
    expect(navColumnWidth("rail", { compact: true, collapsed: true })).toBe(RAIL_WIDTH);
  });

  it("never leaves a gap where there is no column", () => {
    for (const compact of [false, true]) {
      for (const collapsed of [false, true]) {
        expect(navColumnWidth("topbar", { compact, collapsed })).toBe(0);
      }
    }
  });
});
