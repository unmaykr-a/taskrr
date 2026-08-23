// quickAdd.ts — understand a task typed as one line.
//
// "water plants every 2 weeks #home" should not require three more fields to be
// filled in. This reads a cadence, tags and a folder out of the name and hands
// back what it understood, so the form can *show* the interpretation rather than
// applying it invisibly — the parse is a suggestion the user can see and undo,
// which is the only way a magic input is tolerable.
//
// Pure, so the grammar lives in one place and is testable (quickAdd.test.ts).

/** What a line of text was understood to mean. */
export interface QuickAdd {
  /** The name with the recognised parts removed. */
  name: string;
  /** Cadence in seconds, or null if none was found. */
  intervalSeconds: number | null;
  tags: string[];
  folder: string;
  /** True when anything beyond a plain name was recognised. */
  matched: boolean;
}

const UNIT_SECONDS: Record<string, number> = {
  hour: 3_600,
  hours: 3_600,
  day: 86_400,
  days: 86_400,
  week: 604_800,
  weeks: 604_800,
  month: 2_592_000, // 30 days — the app's own "every 30 days" idea of a month
  months: 2_592_000,
  year: 31_536_000, // 365 days
  years: 31_536_000,
};

// "every 2 weeks", "every week", "every 3 days". The number is optional, so
// "every week" reads as one.
const CADENCE = /\bevery\s+(?:(\d{1,4})\s*)?(hours?|days?|weeks?|months?|years?)\b/i;
// "#home" — a tag. Allows letters, digits, dashes and underscores.
const TAG = /#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu;
// "/Home", "@Home", or /"Front Garden" for a name with spaces. One only; the
// last one wins.
//
// A bare folder must be a single word. Letting it run to the next marker read
// naturally when the folder came last ("mow /Front Garden") but swallowed the
// task name when it came first ("/Indoors water plants"), and no amount of
// lookahead fixes that ambiguity — quoting does, explicitly.
const FOLDER = /(?:^|\s)[/@](?:"([^"]+)"|([\p{L}\p{N}][\p{L}\p{N}_-]*))(?=\s|$)/gu;

/**
 * Parse one line into the fields it describes.
 *
 * Nothing is required: a plain name parses to itself with `matched: false`, so
 * callers can tell "the user typed a sentence" from "the user used the syntax".
 */
export function parseQuickAdd(input: string): QuickAdd {
  let rest = input;
  let intervalSeconds: number | null = null;
  const tags: string[] = [];
  let folder = "";

  const cadence = rest.match(CADENCE);
  if (cadence) {
    const amount = cadence[1] ? parseInt(cadence[1], 10) : 1;
    const unit = UNIT_SECONDS[cadence[2].toLowerCase()];
    // A cadence of zero is not a cadence; ignore rather than storing nonsense.
    if (unit && amount > 0) {
      intervalSeconds = amount * unit;
      rest = rest.replace(CADENCE, " ");
    }
  }

  for (const m of rest.matchAll(TAG)) {
    const tag = m[1];
    if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) tags.push(tag);
  }
  if (tags.length > 0) rest = rest.replace(TAG, " ");

  for (const m of rest.matchAll(FOLDER)) folder = (m[1] ?? m[2]).trim();
  if (folder) rest = rest.replace(FOLDER, " ");

  const name = rest.replace(/\s+/g, " ").trim();
  return {
    name,
    intervalSeconds,
    tags,
    folder,
    matched: intervalSeconds !== null || tags.length > 0 || folder !== "",
  };
}

/** A short human description of what was understood, for the hint under the box. */
export function describeQuickAdd(parsed: QuickAdd, formatInterval: (seconds: number) => string): string {
  const parts: string[] = [];
  if (parsed.intervalSeconds != null) parts.push(`every ${formatInterval(parsed.intervalSeconds)}`);
  if (parsed.folder) parts.push(`in ${parsed.folder}`);
  if (parsed.tags.length > 0) parts.push(parsed.tags.map((t) => `#${t}`).join(" "));
  return parts.join(" · ");
}
