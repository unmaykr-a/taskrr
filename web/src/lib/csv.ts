// csv.ts — read a CSV file, and turn its rows into an import document.
//
// The point of this file is that coming *from* another tracker is the half the
// JSON export can't cover. Every product exports a different shape, so rather
// than an adapter per competitor there is one generic mapper: parse the file,
// show the user their own columns, let them say which is the name and which is
// the cadence, and build the document the existing importer already accepts.
//
// Nothing here talks to the server. The output is the same taskrr-export-v1
// document a JSON restore posts, so the CSV path inherits the whole of the
// importer's validation rather than opening a second way in.
//
// Pure and React-free, so the parsing rules are testable (csv.test.ts).

/** A parsed CSV: the header row, and the data rows under it. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/**
 * Parse CSV text.
 *
 * Handles the parts of RFC 4180 that actually show up in exported files:
 * quoted fields, commas and newlines inside quotes, "" as an escaped quote, and
 * CRLF. Also sniffs semicolon and tab delimiters, because European locales
 * export semicolons and half the world's "CSV" is TSV.
 */
export function parseCsv(text: string): CsvTable {
  // Strip a UTF-8 BOM — Excel writes one, and it would otherwise become part of
  // the first header name and quietly break matching.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const delimiter = sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" is one literal quote
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Whatever is left over is the final row, unless the file ended on a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows
    .map((r) => r.map((f) => f.trim()))
    .filter((r) => r.some((f) => f !== "")); // drop blank lines

  if (cleaned.length === 0) return { headers: [], rows: [] };
  const [headers, ...rest] = cleaned;
  return { headers, rows: rest };
}

/** Pick the delimiter by counting candidates in the first line. */
function sniffDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    // Count only outside quotes, so a quoted "Smith, John" doesn't win it.
    let count = 0;
    let quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '"') quoted = !quoted;
      else if (!quoted && firstLine[i] === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Which column means what. -1 means "not mapped". */
export interface CsvMapping {
  name: number;
  description: number;
  folder: number;
  tags: number;
  interval: number;
  lastDone: number;
}

export const EMPTY_MAPPING: CsvMapping = {
  name: -1,
  description: -1,
  folder: -1,
  tags: -1,
  interval: -1,
  lastDone: -1,
};

// Header names worth recognising, roughly in order of confidence. Deliberately
// short: this is a convenience so the common case needs no clicking, not an
// attempt to know every product's vocabulary.
const HINTS: Record<keyof CsvMapping, string[]> = {
  name: ["name", "task", "title", "item", "subject", "todo"],
  description: ["description", "notes", "note", "details", "comment"],
  folder: ["folder", "list", "project", "category", "group", "area"],
  tags: ["tags", "tag", "labels", "label"],
  interval: ["interval", "routine", "repeat", "recurrence", "frequency", "every", "cadence", "cycle"],
  lastDone: ["last done", "lastdone", "last completed", "completed", "done", "last", "date"],
};

/**
 * Guess a mapping from the header names.
 *
 * Exact matches win over partial ones, and each column is claimed once, so a
 * file with both "Task" and "Task notes" doesn't map them to the same field.
 */
export function guessMapping(headers: string[]): CsvMapping {
  const mapping = { ...EMPTY_MAPPING };
  const lower = headers.map((h) => h.trim().toLowerCase());
  const taken = new Set<number>();

  for (const pass of ["exact", "partial"] as const) {
    for (const field of Object.keys(HINTS) as (keyof CsvMapping)[]) {
      if (mapping[field] !== -1) continue;
      for (const hint of HINTS[field]) {
        const at = lower.findIndex(
          (h, i) => !taken.has(i) && (pass === "exact" ? h === hint : h.includes(hint)),
        );
        if (at !== -1) {
          mapping[field] = at;
          taken.add(at);
          break;
        }
      }
    }
  }
  return mapping;
}

const UNIT_SECONDS: Record<string, number> = {
  hour: 3_600,
  day: 86_400,
  week: 604_800,
  month: 2_592_000, // 30 days, matching the app's own idea of a month
  year: 31_536_000,
};

/**
 * Read a cadence out of a cell.
 *
 * Accepts "2 weeks", "every 2 weeks", "weekly", "14d", and a bare "14" — the
 * last using `bareUnit`, because a column of bare numbers is meaningless
 * without the user telling us what they count.
 */
export function parseCsvInterval(raw: string, bareUnit: keyof typeof UNIT_SECONDS = "day"): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // "weekly", "daily", "monthly", "yearly", "annually"
  const named: Record<string, number> = {
    hourly: UNIT_SECONDS.hour,
    daily: UNIT_SECONDS.day,
    weekly: UNIT_SECONDS.week,
    fortnightly: UNIT_SECONDS.week * 2,
    biweekly: UNIT_SECONDS.week * 2,
    monthly: UNIT_SECONDS.month,
    quarterly: UNIT_SECONDS.month * 3,
    yearly: UNIT_SECONDS.year,
    annually: UNIT_SECONDS.year,
  };
  if (named[s]) return named[s];

  // "every 2 weeks", "2 weeks", "2w", "14d"
  const m = s.match(/^(?:every\s+)?(\d+(?:\.\d+)?)\s*(h|hours?|d|days?|w|weeks?|m|months?|y|years?)?$/);
  if (!m) return null;
  const amount = parseFloat(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unitWord = m[2];
  const unit = unitWord ? unitFor(unitWord) : UNIT_SECONDS[bareUnit];
  if (!unit) return null;
  const seconds = Math.round(amount * unit);
  return seconds > 0 ? seconds : null;
}

function unitFor(word: string): number | null {
  if (word.startsWith("h")) return UNIT_SECONDS.hour;
  if (word.startsWith("d")) return UNIT_SECONDS.day;
  if (word.startsWith("w")) return UNIT_SECONDS.week;
  if (word.startsWith("mo") || word === "m") return UNIT_SECONDS.month;
  if (word.startsWith("y")) return UNIT_SECONDS.year;
  return null;
}

/**
 * Read a date out of a cell.
 *
 * ISO (`2026-08-23`, with or without a time) is read directly. Slash and dot
 * formats are genuinely ambiguous — 03/04/2026 is two different days depending
 * on where the file came from — so the caller says which order to read, and
 * nothing is guessed.
 *
 * Dates without a time land at noon local, the same choice backdating from the
 * calendar makes, so a timezone shift can't slide the day.
 */
export function parseCsvDate(raw: string, dayFirst = false): Date | null {
  const s = raw.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, mo, d, h, mi, sec] = iso;
    return atLocal(+y, +mo, +d, h != null, +(h ?? 12), +(mi ?? 0), +(sec ?? 0));
  }

  const slash = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[T ](\d{2}):(\d{2}))?$/);
  if (slash) {
    const [, a, b, y, h, mi] = slash;
    const day = dayFirst ? +a : +b;
    const month = dayFirst ? +b : +a;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return atLocal(+y, month, day, h != null, +(h ?? 12), +(mi ?? 0), 0);
  }
  return null;
}

function atLocal(y: number, mo: number, d: number, hasTime: boolean, h: number, mi: number, s: number): Date | null {
  const date = new Date(y, mo - 1, d, hasTime ? h : 12, mi, s, 0);
  // Reject a rolled-over date (31 February became 3 March) rather than storing
  // a day the file didn't say.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

/** One task, in the shape the importer reads. */
export interface CsvImportTask {
  name: string;
  description?: string;
  intervalSeconds?: number | null;
  tags?: string[];
  folder?: string;
  completions?: { completedAt: string; note?: string }[];
}

export interface CsvImportDocument {
  format: "taskrr-export-v1";
  tasks: CsvImportTask[];
}

export interface CsvConversion {
  document: CsvImportDocument;
  /** Rows that produced nothing, and why — shown before anything is sent. */
  skipped: string[];
}

export interface CsvConvertOptions {
  bareIntervalUnit?: keyof typeof UNIT_SECONDS;
  dayFirstDates?: boolean;
}

/**
 * Turn parsed rows into the document the importer accepts.
 *
 * Deliberately lossy in one direction only: a cell we can't read is reported
 * and dropped, never guessed at. A row without a name is the one thing that
 * loses the whole row, because a task without a name isn't one.
 */
export function csvToImportDocument(
  table: CsvTable,
  mapping: CsvMapping,
  options: CsvConvertOptions = {},
): CsvConversion {
  const { bareIntervalUnit = "day", dayFirstDates = false } = options;
  const tasks: CsvImportTask[] = [];
  const skipped: string[] = [];
  const cell = (row: string[], at: number) => (at >= 0 ? (row[at] ?? "").trim() : "");

  table.rows.forEach((row, i) => {
    // +2: one for the header, one because people count rows from 1.
    const where = `Row ${i + 2}`;
    const name = cell(row, mapping.name);
    if (!name) {
      skipped.push(`${where}: no name`);
      return;
    }

    const task: CsvImportTask = { name };

    const description = cell(row, mapping.description);
    if (description) task.description = description;

    const folder = cell(row, mapping.folder);
    if (folder) task.folder = folder;

    const rawTags = cell(row, mapping.tags);
    if (rawTags) {
      const tags = rawTags
        .split(/[,;|]/)
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      // Case-insensitive de-dupe, keeping the first spelling — same rule as
      // quick add, so the two ways of naming a tag agree.
      const seen = new Set<string>();
      task.tags = tags.filter((t) => {
        const k = t.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    const rawInterval = cell(row, mapping.interval);
    if (rawInterval) {
      const seconds = parseCsvInterval(rawInterval, bareIntervalUnit);
      if (seconds == null) skipped.push(`${where}: couldn't read "${rawInterval}" as a routine`);
      else task.intervalSeconds = seconds;
    }

    const rawDate = cell(row, mapping.lastDone);
    if (rawDate) {
      const when = parseCsvDate(rawDate, dayFirstDates);
      if (when == null) skipped.push(`${where}: couldn't read "${rawDate}" as a date`);
      else if (when.getTime() > Date.now()) skipped.push(`${where}: "${rawDate}" is in the future`);
      else task.completions = [{ completedAt: when.toISOString() }];
    }

    tasks.push(task);
  });

  return { document: { format: "taskrr-export-v1", tasks }, skipped };
}
