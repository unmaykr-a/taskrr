import { describe, expect, it } from "vitest";

import { APP_LAYOUTS, resolveLayout } from "@/lib/layout";

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
