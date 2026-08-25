import { describe, expect, it } from "vitest";

import { storedPrefs } from "@/lib/prefs";

describe("storedPrefs", () => {
  it("takes the stored values", () => {
    expect(storedPrefs({ bgImage: "7", taskColumns: 4 })).toMatchObject({
      bgImage: "7",
      taskColumns: 4,
    });
  });

  it("puts everything the stored copy doesn't mention back to its default", () => {
    // The regression this exists for: applying a stored copy used to merge over
    // whatever the browser held, so a preference survived an account that had
    // never heard of it — a background that came back after restoring a backup
    // taken before the picture existed.
    const restored = storedPrefs({ taskColumns: 4 });
    expect(restored.bgImage).toBe("");
    expect(restored.appLayout).toBe("");
    expect(restored.sidebarCollapsed).toBe(false);
  });

  it("is a full set of preferences even from nothing", () => {
    const empty = storedPrefs({});
    expect(empty.cardSize).toBe("comfortable");
    expect(empty.animations).toBe(true);
  });
});
