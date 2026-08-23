import { describe, expect, it } from "vitest";

import {
  csvToImportDocument,
  guessMapping,
  parseCsv,
  parseCsvDate,
  parseCsvInterval,
  type CsvMapping,
} from "@/lib/csv";

const mapping = (over: Partial<CsvMapping> = {}): CsvMapping => ({
  name: -1, description: -1, folder: -1, tags: -1, interval: -1, lastDone: -1, ...over,
});

describe("parseCsv", () => {
  it("reads a plain file", () => {
    const t = parseCsv("Name,Folder\nWater plants,Home\nBins,Outside");
    expect(t.headers).toEqual(["Name", "Folder"]);
    expect(t.rows).toEqual([["Water plants", "Home"], ["Bins", "Outside"]]);
  });

  it("keeps commas and newlines that are inside quotes", () => {
    const t = parseCsv('Name,Notes\n"Smith, John","line one\nline two"');
    expect(t.rows).toEqual([["Smith, John", "line one\nline two"]]);
  });

  it('reads "" as one literal quote', () => {
    expect(parseCsv('Name\n"He said ""hi"""').rows).toEqual([['He said "hi"']]);
  });

  it("copes with CRLF", () => {
    expect(parseCsv("Name\r\nBins\r\nPlants").rows).toEqual([["Bins"], ["Plants"]]);
  });

  it("strips a BOM rather than gluing it to the first header", () => {
    // Excel writes one, and it would otherwise stop "Name" from ever matching.
    expect(parseCsv("﻿Name,Folder\nBins,Home").headers).toEqual(["Name", "Folder"]);
  });

  it("sniffs semicolons and tabs", () => {
    expect(parseCsv("Name;Folder\nBins;Home").headers).toEqual(["Name", "Folder"]);
    expect(parseCsv("Name\tFolder\nBins\tHome").headers).toEqual(["Name", "Folder"]);
  });

  it("does not let a quoted comma pick the delimiter", () => {
    const t = parseCsv('"Name, full";Folder\n"Smith, John";Home');
    expect(t.headers).toEqual(["Name, full", "Folder"]);
  });

  it("drops blank lines, including a trailing newline", () => {
    expect(parseCsv("Name\nBins\n\nPlants\n").rows).toEqual([["Bins"], ["Plants"]]);
  });

  it("handles an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });
});

describe("guessMapping", () => {
  it("finds the obvious columns", () => {
    const m = guessMapping(["Name", "Description", "Folder", "Tags", "Interval", "Last done"]);
    expect(m).toEqual({ name: 0, description: 1, folder: 2, tags: 3, interval: 4, lastDone: 5 });
  });

  it("recognises other products' vocabulary", () => {
    const m = guessMapping(["Title", "Notes", "Project", "Labels", "Repeat", "Completed"]);
    expect(m.name).toBe(0);
    expect(m.description).toBe(1);
    expect(m.folder).toBe(2);
    expect(m.tags).toBe(3);
    expect(m.interval).toBe(4);
    expect(m.lastDone).toBe(5);
  });

  it("prefers an exact match over a partial one", () => {
    // "Task notes" contains "task", but "Task" is the real name column.
    const m = guessMapping(["Task notes", "Task"]);
    expect(m.name).toBe(1);
  });

  it("never claims one column for two fields", () => {
    const m = guessMapping(["Task", "Task notes"]);
    const used = [m.name, m.description, m.folder, m.tags, m.interval, m.lastDone].filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });

  it("leaves what it cannot recognise unmapped", () => {
    const m = guessMapping(["colA", "colB"]);
    expect(m.name).toBe(-1);
    expect(m.interval).toBe(-1);
  });
});

describe("parseCsvInterval", () => {
  it("reads the phrasings people actually export", () => {
    expect(parseCsvInterval("2 weeks")).toBe(1_209_600);
    expect(parseCsvInterval("every 2 weeks")).toBe(1_209_600);
    expect(parseCsvInterval("weekly")).toBe(604_800);
    expect(parseCsvInterval("14d")).toBe(1_209_600);
    expect(parseCsvInterval("3 months")).toBe(3 * 2_592_000);
    expect(parseCsvInterval("quarterly")).toBe(3 * 2_592_000);
  });

  it("uses the chosen unit for a bare number", () => {
    // A column of bare numbers means nothing until the user says what it counts.
    expect(parseCsvInterval("14", "day")).toBe(1_209_600);
    expect(parseCsvInterval("2", "week")).toBe(1_209_600);
  });

  it("is case-insensitive and tolerates spacing", () => {
    expect(parseCsvInterval("  Every 3 DAYS ")).toBe(259_200);
  });

  it("refuses nonsense rather than storing it", () => {
    expect(parseCsvInterval("")).toBeNull();
    expect(parseCsvInterval("0 days")).toBeNull();
    expect(parseCsvInterval("when I feel like it")).toBeNull();
    expect(parseCsvInterval("-3 days")).toBeNull();
    expect(parseCsvInterval("2 fortnights")).toBeNull();
  });
});

describe("parseCsvDate", () => {
  it("reads ISO dates", () => {
    const d = parseCsvDate("2026-08-23")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 7, 23]);
    // Noon local, so a timezone shift can't slide the day.
    expect(d.getHours()).toBe(12);
  });

  it("keeps an explicit time", () => {
    const d = parseCsvDate("2026-08-23T09:30")!;
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 30]);
  });

  it("reads slash dates in whichever order it is told", () => {
    // The whole reason this is a setting: 03/04/2026 is two different days.
    const us = parseCsvDate("03/04/2026", false)!;
    expect([us.getMonth(), us.getDate()]).toEqual([2, 4]);
    const uk = parseCsvDate("03/04/2026", true)!;
    expect([uk.getMonth(), uk.getDate()]).toEqual([3, 3]);
  });

  it("rejects a date that does not exist", () => {
    // Without the check this silently becomes 3 March.
    expect(parseCsvDate("2026-02-31")).toBeNull();
    expect(parseCsvDate("31/02/2026", true)).toBeNull();
  });

  it("refuses what it cannot read", () => {
    expect(parseCsvDate("")).toBeNull();
    expect(parseCsvDate("last Tuesday")).toBeNull();
    expect(parseCsvDate("23 August 2026")).toBeNull();
  });
});

describe("csvToImportDocument", () => {
  const table = parseCsv(
    [
      "Name,Notes,List,Labels,Repeat,Completed",
      "Water plants,The big one,Home,\"home, plants\",2 weeks,2026-08-01",
      "Bins,,Outside,home,weekly,2026-08-20",
    ].join("\n"),
  );
  const full = guessMapping(table.headers);

  it("builds a document the importer accepts", () => {
    const { document } = csvToImportDocument(table, full);
    expect(document.format).toBe("taskrr-export-v1");
    expect(document.tasks).toHaveLength(2);
    const [plants] = document.tasks;
    expect(plants.name).toBe("Water plants");
    expect(plants.description).toBe("The big one");
    expect(plants.folder).toBe("Home");
    expect(plants.tags).toEqual(["home", "plants"]);
    expect(plants.intervalSeconds).toBe(1_209_600);
    expect(plants.completions).toHaveLength(1);
  });

  it("splits tags on commas, semicolons and pipes, and drops a leading #", () => {
    const t = parseCsv("Name,Tags\nx,\"#home; garden|Home\"");
    const { document } = csvToImportDocument(t, mapping({ name: 0, tags: 1 }));
    expect(document.tasks[0].tags).toEqual(["home", "garden"]);
  });

  it("loses the row when there is no name, and says so", () => {
    const t = parseCsv("Name,Folder\n,Home\nBins,Home");
    const { document, skipped } = csvToImportDocument(t, mapping({ name: 0, folder: 1 }));
    expect(document.tasks).toHaveLength(1);
    expect(skipped).toEqual(["Row 2: no name"]);
  });

  it("keeps the task but reports a cell it could not read", () => {
    // A bad cadence shouldn't cost you the task — you'd rather have the task.
    const t = parseCsv("Name,Repeat\nBins,whenever");
    const { document, skipped } = csvToImportDocument(t, mapping({ name: 0, interval: 1 }));
    expect(document.tasks).toHaveLength(1);
    expect(document.tasks[0].intervalSeconds).toBeUndefined();
    expect(skipped[0]).toContain('couldn\'t read "whenever" as a routine');
  });

  it("refuses a completion dated in the future", () => {
    const t = parseCsv("Name,Completed\nBins,2099-01-01");
    const { document, skipped } = csvToImportDocument(t, mapping({ name: 0, lastDone: 1 }));
    expect(document.tasks[0].completions).toBeUndefined();
    expect(skipped[0]).toContain("in the future");
  });

  it("counts rows the way a spreadsheet does", () => {
    // Row 1 is the header, so the first data row is row 2.
    const t = parseCsv("Name\nok\n\n");
    const { skipped } = csvToImportDocument(parseCsv("Name\n\nok"), mapping({ name: 0 }));
    expect(t.rows).toHaveLength(1);
    expect(skipped).toEqual([]); // the blank line was dropped, not counted
  });

  it("leaves unmapped fields out entirely", () => {
    const t = parseCsv("Name,Whatever\nBins,ignored");
    const { document } = csvToImportDocument(t, mapping({ name: 0 }));
    expect(document.tasks[0]).toEqual({ name: "Bins" });
  });

  it("handles a short row without inventing empty values", () => {
    const t = parseCsv("Name,Folder,Tags\nBins");
    const { document } = csvToImportDocument(t, mapping({ name: 0, folder: 1, tags: 2 }));
    expect(document.tasks[0]).toEqual({ name: "Bins" });
  });
});
