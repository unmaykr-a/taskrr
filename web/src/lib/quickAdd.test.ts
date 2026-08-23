import { describe, expect, it } from "vitest";

import { describeQuickAdd, parseQuickAdd } from "@/lib/quickAdd";
import { formatInterval } from "@/lib/time";

const DAY = 86_400;
const WEEK = 604_800;

describe("parseQuickAdd", () => {
  it("leaves a plain name completely alone", () => {
    const got = parseQuickAdd("water the plants");
    expect(got.name).toBe("water the plants");
    expect(got.intervalSeconds).toBeNull();
    expect(got.tags).toEqual([]);
    expect(got.folder).toBe("");
    // The flag is what lets the UI stay quiet unless the syntax was used.
    expect(got.matched).toBe(false);
  });

  it("reads a cadence and takes it out of the name", () => {
    const got = parseQuickAdd("water plants every 2 weeks");
    expect(got.name).toBe("water plants");
    expect(got.intervalSeconds).toBe(2 * WEEK);
    expect(got.matched).toBe(true);
  });

  it("treats a bare unit as one of it", () => {
    expect(parseQuickAdd("bins every week").intervalSeconds).toBe(WEEK);
    expect(parseQuickAdd("standup every day").intervalSeconds).toBe(DAY);
  });

  it("understands every unit it offers", () => {
    expect(parseQuickAdd("x every 6 hours").intervalSeconds).toBe(6 * 3600);
    expect(parseQuickAdd("x every 3 days").intervalSeconds).toBe(3 * DAY);
    expect(parseQuickAdd("x every 2 months").intervalSeconds).toBe(2 * 2_592_000);
    expect(parseQuickAdd("x every 1 year").intervalSeconds).toBe(31_536_000);
  });

  it("is case-insensitive about the keyword", () => {
    expect(parseQuickAdd("Bins Every 2 Weeks").intervalSeconds).toBe(2 * WEEK);
  });

  it("reads tags", () => {
    const got = parseQuickAdd("water plants #home #plants");
    expect(got.name).toBe("water plants");
    expect(got.tags).toEqual(["home", "plants"]);
  });

  it("de-duplicates tags case-insensitively, keeping the first spelling", () => {
    expect(parseQuickAdd("x #Home #home").tags).toEqual(["Home"]);
  });

  it("reads a folder with either marker", () => {
    expect(parseQuickAdd("vacuum /Home").folder).toBe("Home");
    expect(parseQuickAdd("vacuum @Home").folder).toBe("Home");
    expect(parseQuickAdd("vacuum /Home").name).toBe("vacuum");
  });

  it("takes a bare folder as one word, leaving the rest as the name", () => {
    // The ambiguity this settles: a folder that ran to the next marker would
    // swallow the task name whenever the folder was typed first.
    const got = parseQuickAdd("/Indoors water plants");
    expect(got.folder).toBe("Indoors");
    expect(got.name).toBe("water plants");
  });

  it("allows spaces in a folder name when it is quoted", () => {
    const got = parseQuickAdd(`mow /"Front Garden" #outdoor`);
    expect(got.folder).toBe("Front Garden");
    expect(got.tags).toEqual(["outdoor"]);
    expect(got.name).toBe("mow");
  });

  it("takes the last folder when several are given", () => {
    expect(parseQuickAdd("x /One /Two").folder).toBe("Two");
  });

  it("reads all three at once, in any order", () => {
    const a = parseQuickAdd("water plants every 2 weeks #home /Indoors");
    const b = parseQuickAdd("#home every 2 weeks /Indoors water plants");
    for (const got of [a, b]) {
      expect(got.intervalSeconds).toBe(2 * WEEK);
      expect(got.tags).toEqual(["home"]);
      expect(got.folder).toBe("Indoors");
    }
    expect(a.name).toBe("water plants");
  });

  it("ignores a nonsense cadence rather than storing it", () => {
    // "every 0 days" is not a routine; the words stay in the name.
    const got = parseQuickAdd("x every 0 days");
    expect(got.intervalSeconds).toBeNull();
    expect(got.name).toContain("every 0 days");
  });

  it("leaves an unrecognised unit in the name", () => {
    const got = parseQuickAdd("x every 2 fortnights");
    expect(got.intervalSeconds).toBeNull();
    expect(got.name).toBe("x every 2 fortnights");
  });

  it("does not treat a mid-word hash or slash as syntax", () => {
    // A name that merely contains these characters shouldn't be carved up.
    expect(parseQuickAdd("read C# docs").tags).toEqual([]);
    expect(parseQuickAdd("check 24/7 alarm").folder).toBe("");
  });

  it("collapses the whitespace it leaves behind", () => {
    expect(parseQuickAdd("water   plants  every 2 weeks   #home").name).toBe("water plants");
  });

  it("copes with only syntax and no name", () => {
    const got = parseQuickAdd("#home");
    expect(got.name).toBe("");
    expect(got.tags).toEqual(["home"]);
    // The caller still has to require a name; parsing doesn't invent one.
    expect(got.matched).toBe(true);
  });

  it("handles an empty string", () => {
    const got = parseQuickAdd("");
    expect(got.name).toBe("");
    expect(got.matched).toBe(false);
  });
});

describe("describeQuickAdd", () => {
  it("summarises what was understood", () => {
    const parsed = parseQuickAdd("water plants every 2 weeks #home /Indoors");
    expect(describeQuickAdd(parsed, formatInterval)).toBe("every 2 weeks · in Indoors · #home");
  });

  it("is empty when nothing was recognised", () => {
    expect(describeQuickAdd(parseQuickAdd("water plants"), formatInterval)).toBe("");
  });
});
