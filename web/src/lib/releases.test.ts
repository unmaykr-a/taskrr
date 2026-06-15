import { describe, expect, it } from "vitest";

import pkg from "../../package.json";
import { compareVersions, RELEASES, releasesSince } from "@/lib/releases";

const LATEST = RELEASES[0].version;

describe("releases data", () => {
  it("lists the app's version first (forces a changelog entry on every bump)", () => {
    expect(RELEASES[0].version).toBe(pkg.version);
  });

  it("is sorted strictly newest-first", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(compareVersions(RELEASES[i - 1].version, RELEASES[i].version)).toBeGreaterThan(0);
    }
  });

  it("has at least one non-empty change per release", () => {
    for (const r of RELEASES) {
      expect(r.changes.length).toBeGreaterThan(0);
      for (const c of r.changes) expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.10.1", "1.10.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.13.0", "1.13.0")).toBe(0);
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
  });
});

describe("releasesSince", () => {
  it("returns every release strictly newer than the seen version, across gaps", () => {
    // Updating from the oldest recorded release shows everything since, newest first.
    const oldest = RELEASES[RELEASES.length - 1].version;
    const since = releasesSince(oldest).map((r) => r.version);
    expect(since).toHaveLength(RELEASES.length - 1);
    expect(since[0]).toBe(LATEST);
    expect(since).not.toContain(oldest);
    // From any mid-history version, every result is strictly newer.
    const mid = RELEASES[Math.floor(RELEASES.length / 2)].version;
    expect(releasesSince(mid).every((r) => compareVersions(r.version, mid) > 0)).toBe(true);
  });

  it("is empty when the seen version is current or ahead", () => {
    expect(releasesSince(LATEST)).toHaveLength(0);
    expect(releasesSince("99.0.0")).toHaveLength(0);
  });
});
