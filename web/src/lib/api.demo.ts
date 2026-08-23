// In-browser mock of the Taskrr API, used only by the static GitHub Pages demo
// (the `__DEMO__` build). It implements the exact same surface as the real HTTP
// client in api.ts, so every component, query and mutation works unchanged — the
// only swap happens at the single seam at the bottom of api.ts.
//
// There is no server: tasks, completions and preferences live in localStorage,
// seeded on first visit with a realistic spread of tasks and history (relative
// to "now", so the demo always looks alive). Every visitor gets their own
// private sandbox; a "Reset demo" control wipes it (see DemoBanner).
//
// Server-only/admin features (users, sessions, logs, backups, OIDC, reminders
// delivery) are stubbed: the demo account is a plain user, so the admin UI is
// hidden, and the few self-service calls that remain resolve harmlessly.

import type {
  Activity,
  Api,
  AuthConfig,
  Completion,
  ReminderSettings,
  Task,
  TaskInput,
  User,
} from "./api";

const DAY = 86_400;
const HOUR = 3_600;

// --- persistence -----------------------------------------------------------

const DB_KEY = "taskrr-demo-db";
const PREFS_KEY = "taskrr-demo-prefs";
const SESSION_KEY = "taskrr-demo-session"; // "out" once signed out, else signed in
const USERNAME_KEY = "taskrr-demo-username";

/** All localStorage keys this demo owns — cleared by the banner's reset. */
export const DEMO_KEYS = [DB_KEY, PREFS_KEY, SESSION_KEY, USERNAME_KEY];

interface StoredTask {
  id: number;
  name: string;
  description: string;
  intervalSeconds: number | null;
  colorFresh: string | null;
  colorOverdue: string | null;
  freezeColor: boolean;
  tags: string[];
  folder: string;
  archivedAt: string | null;
  // Optional so a sandbox saved by an older demo build still loads; the
  // projection below fills in the defaults.
  snoozedUntil?: string | null;
  pinned?: boolean;
  rotate?: boolean;
  reminderLeadSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface StoredCompletion {
  id: number;
  taskId: number;
  completedAt: string;
  note: string;
  createdAt: string;
}

interface DB {
  tasks: StoredTask[];
  completions: StoredCompletion[];
  nextTaskId: number;
  nextCompletionId: number;
  /** Bumped whenever the seed data changes, so returning visitors get the
   *  refreshed demo instead of an old cached one. */
  seedVersion?: number;
  /** Which seasonal task list this sandbox was seeded from. */
  season?: Season;
}

// Bump this when SEED below changes so existing visitors are re-seeded. The demo
// DB is disposable, so re-seeding simply replaces it with the newer sample set.
const SEED_VERSION = 3;

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw) as DB;
      if (db.seedVersion === SEED_VERSION) return db;
      // Older (or unversioned) sample set — fall through to a fresh seed.
    }
  } catch {
    // corrupt or unavailable — fall through to a fresh seed
  }
  // First visit picks the season from the calendar, so someone arriving in
  // December is looking at frozen pipes rather than mowing the lawn.
  const seeded = seed(seasonNow());
  saveDB(seeded);
  return seeded;
}

/**
 * Re-seed the sandbox from a different season's task list.
 *
 * The demo DB is disposable by design, so this simply replaces it — which does
 * mean losing anything the visitor has changed, hence the confirmation in the
 * banner that offers it.
 */
export function reseedDemo(season: Season) {
  saveDB(seed(season));
}

/** The season the current sandbox is showing. */
export function currentDemoSeason(): Season {
  return loadDB().season ?? seasonNow();
}

function saveDB(db: DB) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // storage disabled / private mode — the demo still works for this session
  }
}

// --- seed data --------------------------------------------------------------

const iso = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();

/** A task to seed, plus the ages (in seconds-ago) of its logged completions. */
interface SeedTask {
  name: string;
  description?: string;
  intervalSeconds: number | null;
  freezeColor?: boolean;
  colorFresh?: string | null;
  colorOverdue?: string | null;
  archived?: boolean;
  tags?: string[];
  folder?: string;
  /** Completion ages in seconds-ago, newest first. */
  log: number[];
  /** Optional notes keyed by index into `log`. */
  notes?: Record<number, string>;
}

// The sample set is in two halves.
//
// YEAR_ROUND is everything that doesn't care what month it is — the household,
// kitchen, pet, health, tech and money chores. It lands across fresh /
// due-soon / overdue / never-done with dense history over the last ~30 days, so
// the calendar and activity chart look alive, and it exercises the features one
// demo user can see: cadences, tags, folders, notes, per-task colours, frozen
// colours, no-cadence streaks, and archiving.
//
// SEASONAL is the other half, and it is a different list per season. A tracker
// for "how long since I did that" is at its most recognisable when the list
// matches the time of year you're reading it, and the seasonal chores are the
// ones people most often can't remember doing.
const YEAR_ROUND: SeedTask[] = [
  // --- Home ----------------------------------------------------------------
  {
    name: "Water the plants",
    description: "The big ones by the window get thirsty fast.",
    intervalSeconds: 3 * DAY,
    tags: ["plants", "home"],
    folder: "Home",
    log: [2 * DAY + 8 * HOUR, 5 * DAY, 8 * DAY, 11 * DAY, 15 * DAY, 18 * DAY, 22 * DAY, 27 * DAY, 31 * DAY],
    notes: { 2: "skipped the succulents" },
  },
  {
    name: "Change bed sheets",
    intervalSeconds: 7 * DAY,
    tags: ["home", "cleaning"],
    folder: "Home",
    log: [6 * DAY, 13 * DAY, 21 * DAY, 29 * DAY, 36 * DAY],
  },
  {
    name: "Vacuum the apartment",
    description: "Living room and hallway at least.",
    intervalSeconds: 5 * DAY,
    tags: ["cleaning", "home"],
    folder: "Home",
    log: [6 * DAY, 11 * DAY, 16 * DAY, 21 * DAY, 26 * DAY, 31 * DAY],
  },
  {
    name: "Clean the bathroom",
    intervalSeconds: 7 * DAY,
    tags: ["cleaning", "home"],
    folder: "Home",
    log: [9 * DAY, 16 * DAY, 24 * DAY, 32 * DAY],
    notes: { 0: "ran out of descaler" },
  },
  {
    name: "Mop the floors",
    intervalSeconds: 10 * DAY,
    tags: ["cleaning", "home"],
    folder: "Home",
    log: [1 * DAY + 4 * HOUR, 11 * DAY, 22 * DAY, 33 * DAY],
  },
  {
    name: "Dust the shelves",
    intervalSeconds: 14 * DAY,
    tags: ["cleaning", "home"],
    folder: "Home",
    log: [1 * DAY, 15 * DAY, 30 * DAY],
  },
  {
    name: "Take out the recycling",
    intervalSeconds: 7 * DAY,
    tags: ["home", "chores"],
    folder: "Home",
    log: [1 * DAY + 6 * HOUR, 8 * DAY, 15 * DAY, 22 * DAY, 29 * DAY],
  },
  {
    name: "Water the herb garden",
    description: "Basil sulks if it dries out.",
    intervalSeconds: 2 * DAY,
    tags: ["plants", "kitchen"],
    folder: "Home",
    freezeColor: true,
    colorFresh: "#10b981",
    log: [20 * HOUR, 2 * DAY + 18 * HOUR, 4 * DAY, 6 * DAY, 9 * DAY, 12 * DAY, 15 * DAY],
  },
  {
    name: "Check the smoke alarms",
    description: "Press and hold until it chirps.",
    intervalSeconds: 365 * DAY,
    tags: ["home", "safety"],
    folder: "Home",
    log: [210 * DAY],
  },
  {
    name: "Service the boiler",
    description: "Annual service — not booked yet.",
    intervalSeconds: 365 * DAY,
    tags: ["home", "safety"],
    folder: "Home",
    log: [],
  },
  {
    name: "Replace the HVAC filter",
    intervalSeconds: 90 * DAY,
    tags: ["home"],
    folder: "Home",
    log: [],
  },

  // --- Kitchen -------------------------------------------------------------
  {
    name: "Wipe the kitchen counters",
    intervalSeconds: 1 * DAY,
    tags: ["kitchen", "cleaning"],
    folder: "Kitchen",
    log: [4 * HOUR, 1 * DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 8 * DAY, 10 * DAY, 12 * DAY],
  },
  {
    name: "Descale the coffee machine",
    intervalSeconds: 60 * DAY,
    tags: ["kitchen", "home"],
    folder: "Kitchen",
    log: [70 * DAY, 132 * DAY],
    notes: { 0: "tasted much better after" },
  },
  {
    name: "Replace the water filter",
    description: "Brita jug in the fridge.",
    intervalSeconds: 30 * DAY,
    tags: ["kitchen", "home"],
    folder: "Kitchen",
    log: [28 * DAY, 59 * DAY, 90 * DAY],
  },
  {
    name: "Clean out the fridge",
    description: "Toss anything past its date.",
    intervalSeconds: 14 * DAY,
    tags: ["kitchen", "cleaning"],
    folder: "Kitchen",
    log: [13 * DAY, 28 * DAY, 41 * DAY],
  },
  {
    name: "Sharpen the knives",
    intervalSeconds: 60 * DAY,
    tags: ["kitchen"],
    folder: "Kitchen",
    log: [70 * DAY],
  },
  {
    name: "Feed the sourdough starter",
    description: "Equal parts flour and water.",
    intervalSeconds: 1 * DAY,
    tags: ["kitchen", "hobby"],
    folder: "Kitchen",
    freezeColor: true,
    colorFresh: "#f59e0b",
    log: [10 * HOUR, 1 * DAY + 2 * HOUR, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 8 * DAY, 9 * DAY],
  },

  // --- Pets ----------------------------------------------------------------
  {
    name: "Clean the litter box",
    description: "Scoop daily, full change weekly.",
    intervalSeconds: 1 * DAY,
    tags: ["pets"],
    folder: "Pets",
    log: [20 * HOUR, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 8 * DAY, 9 * DAY, 10 * DAY, 11 * DAY, 12 * DAY],
  },
  {
    name: "Walk the dog",
    intervalSeconds: 1 * DAY,
    tags: ["pets", "outdoors"],
    folder: "Pets",
    log: [5 * HOUR, 1 * DAY, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 8 * DAY, 9 * DAY, 10 * DAY, 11 * DAY],
  },
  {
    name: "Refill the cat fountain",
    intervalSeconds: 3 * DAY,
    tags: ["pets"],
    folder: "Pets",
    log: [12 * HOUR, 3 * DAY, 6 * DAY, 9 * DAY, 12 * DAY],
  },
  {
    name: "Trim the dog's nails",
    intervalSeconds: 30 * DAY,
    tags: ["pets", "health"],
    folder: "Pets",
    log: [34 * DAY, 66 * DAY],
    notes: { 0: "used the grinder this time" },
  },
  {
    name: "Buy pet food",
    intervalSeconds: 21 * DAY,
    tags: ["pets", "shopping"],
    folder: "Pets",
    log: [2 * DAY, 23 * DAY, 45 * DAY],
  },

  // --- Health --------------------------------------------------------------
  {
    name: "Take vitamins",
    intervalSeconds: 1 * DAY,
    tags: ["health"],
    folder: "Health",
    log: [22 * HOUR, 2 * DAY, 3 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 8 * DAY, 9 * DAY, 10 * DAY, 11 * DAY],
  },
  {
    name: "Go for a run",
    description: "Even a short one counts.",
    intervalSeconds: 2 * DAY,
    tags: ["health", "fitness"],
    folder: "Health",
    log: [1 * DAY + 18 * HOUR, 4 * DAY, 6 * DAY, 9 * DAY, 11 * DAY, 14 * DAY, 17 * DAY],
    notes: { 0: "new 5k best" },
  },
  {
    name: "Replace the toothbrush head",
    intervalSeconds: 30 * DAY,
    tags: ["health"],
    folder: "Health",
    log: [35 * DAY, 66 * DAY],
  },
  {
    name: "Refill the prescription",
    intervalSeconds: 30 * DAY,
    tags: ["health"],
    folder: "Health",
    log: [25 * DAY, 55 * DAY],
  },
  {
    name: "Dentist checkup",
    intervalSeconds: 182 * DAY,
    tags: ["health", "appointments"],
    folder: "Health",
    log: [120 * DAY],
  },

  // --- Tech ----------------------------------------------------------------
  {
    name: "Back up the NAS",
    description: "Pull a fresh snapshot to the offsite drive.",
    intervalSeconds: 14 * DAY,
    tags: ["tech", "backup"],
    folder: "Tech",
    log: [12 * DAY, 26 * DAY, 41 * DAY, 56 * DAY],
    notes: { 0: "all volumes verified" },
  },
  {
    name: "Update the home server",
    description: "apt upgrade + reboot if needed.",
    intervalSeconds: 30 * DAY,
    tags: ["tech"],
    folder: "Tech",
    log: [5 * DAY, 36 * DAY],
  },
  {
    name: "Rotate API keys",
    intervalSeconds: 90 * DAY,
    tags: ["tech", "security"],
    folder: "Tech",
    log: [100 * DAY],
    notes: { 0: "rotated and re-deployed" },
  },
  {
    name: "Clean the keyboard",
    intervalSeconds: 30 * DAY,
    tags: ["tech", "cleaning"],
    folder: "Tech",
    log: [4 * DAY, 35 * DAY],
  },
  {
    name: "Check the UPS battery",
    intervalSeconds: 180 * DAY,
    tags: ["tech"],
    folder: "Tech",
    log: [60 * DAY],
  },

  // --- Car -----------------------------------------------------------------
  {
    name: "Check tire pressure",
    intervalSeconds: 30 * DAY,
    tags: ["car"],
    folder: "Car",
    log: [38 * DAY, 71 * DAY],
  },
  {
    name: "Wash the car",
    intervalSeconds: 21 * DAY,
    tags: ["car", "cleaning"],
    folder: "Car",
    log: [26 * DAY, 50 * DAY],
  },
  {
    name: "Refuel",
    intervalSeconds: 10 * DAY,
    tags: ["car"],
    folder: "Car",
    log: [9 * DAY, 19 * DAY, 30 * DAY],
  },
  {
    name: "Oil change",
    description: "Every 6 months or 8,000 km.",
    intervalSeconds: 180 * DAY,
    tags: ["car"],
    folder: "Car",
    log: [90 * DAY],
  },

  // --- Finance -------------------------------------------------------------
  {
    name: "Pay the rent",
    intervalSeconds: 30 * DAY,
    tags: ["finance", "bills"],
    folder: "Finance",
    colorOverdue: "#ef4444",
    log: [4 * DAY, 34 * DAY, 64 * DAY],
  },
  {
    name: "Review subscriptions",
    description: "Cancel anything unused.",
    intervalSeconds: 30 * DAY,
    tags: ["finance"],
    folder: "Finance",
    log: [3 * DAY, 33 * DAY],
    notes: { 0: "dropped two streaming services" },
  },
  {
    name: "Update the budget",
    intervalSeconds: 7 * DAY,
    tags: ["finance"],
    folder: "Finance",
    log: [6 * DAY, 13 * DAY, 20 * DAY, 27 * DAY],
  },

  // The seasonal half of the list lives in SEASONAL below.

  // --- No folder (personal) ------------------------------------------------
  {
    name: "Call grandma",
    description: "She likes Sunday afternoons.",
    intervalSeconds: 14 * DAY,
    tags: ["family"],
    log: [10 * DAY, 24 * DAY, 39 * DAY],
    notes: { 0: "told her about the new job" },
  },
  {
    name: "Journal",
    description: "A few lines before sleep.",
    intervalSeconds: 1 * DAY,
    tags: ["hobby", "mindfulness"],
    log: [8 * HOUR, 1 * DAY, 2 * DAY, 4 * DAY, 5 * DAY, 6 * DAY, 7 * DAY, 9 * DAY, 10 * DAY],
  },
  {
    name: "Read before bed",
    description: "Just tracking the streak — no schedule.",
    intervalSeconds: null,
    tags: ["hobby"],
    log: [14 * HOUR, 2 * DAY, 3 * DAY, 5 * DAY, 6 * DAY, 9 * DAY, 12 * DAY, 13 * DAY, 19 * DAY, 25 * DAY],
  },
  {
    name: "Water the office plant",
    intervalSeconds: 4 * DAY,
    tags: ["plants", "work"],
    log: [6 * HOUR, 4 * DAY, 8 * DAY, 12 * DAY, 16 * DAY],
  },
  {
    name: "Water the succulents",
    description: "Hardly ever — they like it dry.",
    intervalSeconds: 21 * DAY,
    tags: ["plants", "home"],
    log: [],
  },
];


/** Which of the four task lists the demo is showing. */
export type Season = "spring" | "summer" | "autumn" | "winter";

export const SEASONS: { value: Season; label: string }[] = [
  { value: "spring", label: "Spring" },
  { value: "summer", label: "Summer" },
  { value: "autumn", label: "Autumn" },
  { value: "winter", label: "Winter" },
];

/**
 * The season by the calendar, northern-hemisphere.
 *
 * A guess, and a wrong one for half the planet — which is why the banner lets
 * anyone pick a different list rather than this being the only way in.
 */
export function seasonNow(now: Date = new Date()): Season {
  const m = now.getMonth(); // 0 = January
  if (m <= 1 || m === 11) return "winter"; // Dec–Feb
  if (m <= 4) return "spring"; // Mar–May
  if (m <= 7) return "summer"; // Jun–Aug
  return "autumn"; // Sep–Nov
}

// The seasonal half of the sample set. Each list is the same shape as
// YEAR_ROUND and simply replaces the other one's outdoor chores, so switching
// season changes what the demo is *about* rather than shuffling the same tasks.
const SEASONAL: Record<Season, SeedTask[]> = {
  spring: [
    {
      name: "Sow the tomato seeds",
      description: "Windowsill tray, out to the greenhouse once it warms up.",
      intervalSeconds: 365 * DAY,
      tags: ["garden", "outdoors"],
      folder: "Garden",
      log: [12 * DAY],
    },
    {
      name: "Prune the roses",
      intervalSeconds: 365 * DAY,
      tags: ["garden", "outdoors"],
      folder: "Garden",
      log: [26 * DAY],
      notes: { 0: "took the dead wood out of the climber too" },
    },
    {
      name: "Rake the moss out of the lawn",
      intervalSeconds: 180 * DAY,
      tags: ["garden", "outdoors"],
      folder: "Garden",
      log: [31 * DAY],
    },
    {
      name: "Service the lawnmower",
      description: "Blade, spark plug, oil — before the grass gets going.",
      intervalSeconds: 365 * DAY,
      tags: ["outdoors", "maintenance"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Plant out the seedlings",
      intervalSeconds: null,
      tags: ["garden"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Clean the windows inside and out",
      description: "The spring-clean one nobody enjoys.",
      intervalSeconds: 180 * DAY,
      tags: ["cleaning", "home"],
      folder: "Home",
      log: [40 * DAY],
    },
    {
      name: "Wash the winter coats",
      intervalSeconds: 365 * DAY,
      tags: ["home", "cleaning"],
      folder: "Home",
      log: [9 * DAY],
    },
    {
      name: "Swap to the summer tyres",
      intervalSeconds: 180 * DAY,
      tags: ["car"],
      folder: "Car",
      log: [18 * DAY],
    },
    {
      name: "Refill the hay fever tablets",
      intervalSeconds: 30 * DAY,
      tags: ["health"],
      folder: "Health",
      log: [21 * DAY, 52 * DAY],
    },
    {
      name: "Scrub the barbecue",
      description: "First decent weekend, ideally before anyone's coming over.",
      intervalSeconds: 365 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Grit the front path",
      description: "Archived until the frost comes back.",
      intervalSeconds: 365 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      archived: true,
      log: [80 * DAY],
    },
  ],

  summer: [
    {
      name: "Mow the lawn",
      intervalSeconds: 10 * DAY,
      tags: ["outdoors", "garden"],
      folder: "Garden",
      log: [13 * DAY, 24 * DAY, 35 * DAY],
    },
    {
      name: "Water the outdoor plants",
      intervalSeconds: 2 * DAY,
      tags: ["outdoors", "plants", "garden"],
      folder: "Garden",
      log: [1 * DAY + 2 * HOUR, 3 * DAY, 5 * DAY, 7 * DAY, 9 * DAY, 11 * DAY, 13 * DAY],
    },
    {
      name: "Deadhead the flowers",
      intervalSeconds: 7 * DAY,
      tags: ["garden"],
      folder: "Garden",
      log: [5 * DAY, 12 * DAY, 20 * DAY],
    },
    {
      name: "Top up the bird bath",
      intervalSeconds: 3 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [1 * DAY, 4 * DAY, 8 * DAY, 11 * DAY],
    },
    {
      name: "Pick the tomatoes",
      intervalSeconds: 4 * DAY,
      tags: ["garden"],
      folder: "Garden",
      log: [2 * DAY, 6 * DAY, 10 * DAY],
      notes: { 0: "first proper handful" },
    },
    {
      name: "Clean the barbecue grill",
      intervalSeconds: 14 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [17 * DAY, 33 * DAY],
    },
    {
      name: "Air-conditioning filter",
      intervalSeconds: 30 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [28 * DAY, 60 * DAY],
    },
    {
      name: "Check the sunscreen dates",
      intervalSeconds: 365 * DAY,
      tags: ["health"],
      folder: "Health",
      log: [],
    },
    {
      name: "Water the greenhouse",
      intervalSeconds: 1 * DAY,
      tags: ["garden", "plants"],
      folder: "Garden",
      log: [10 * HOUR, 1 * DAY + 9 * HOUR, 2 * DAY + 10 * HOUR, 3 * DAY + 8 * HOUR],
    },
    {
      name: "Rinse the paddling pool",
      intervalSeconds: 5 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [7 * DAY],
    },
    {
      name: "Bleed the radiators",
      description: "Archived until the heating goes back on.",
      intervalSeconds: 365 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      archived: true,
      log: [150 * DAY],
    },
  ],

  autumn: [
    {
      name: "Rake the leaves",
      intervalSeconds: 7 * DAY,
      tags: ["outdoors", "garden"],
      folder: "Garden",
      log: [4 * DAY, 12 * DAY, 19 * DAY],
    },
    {
      name: "Clear the gutters",
      description: "Before the first proper downpour, not after.",
      intervalSeconds: 180 * DAY,
      tags: ["outdoors", "maintenance"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Plant the spring bulbs",
      intervalSeconds: 365 * DAY,
      tags: ["garden"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Cut back the perennials",
      intervalSeconds: 365 * DAY,
      tags: ["garden"],
      folder: "Garden",
      log: [22 * DAY],
    },
    {
      name: "Bring in the tender plants",
      intervalSeconds: 365 * DAY,
      tags: ["garden", "plants"],
      folder: "Garden",
      log: [],
    },
    {
      name: "Service the boiler",
      description: "Ideally before you need it, not the week you do.",
      intervalSeconds: 365 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [340 * DAY],
    },
    {
      name: "Bleed the radiators",
      intervalSeconds: 180 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [16 * DAY],
    },
    {
      name: "Sweep the chimney",
      intervalSeconds: 365 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [355 * DAY],
    },
    {
      name: "Swap to the winter tyres",
      intervalSeconds: 180 * DAY,
      tags: ["car"],
      folder: "Car",
      log: [],
    },
    {
      name: "Put the hedgehog food out",
      intervalSeconds: 2 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [1 * DAY, 3 * DAY, 6 * DAY],
    },
    {
      name: "Flu jab",
      intervalSeconds: 365 * DAY,
      tags: ["health"],
      folder: "Health",
      log: [],
    },
    {
      name: "Water the outdoor plants",
      description: "Archived — the rain is doing it now.",
      intervalSeconds: 2 * DAY,
      tags: ["outdoors", "plants"],
      folder: "Garden",
      archived: true,
      log: [45 * DAY],
    },
  ],

  winter: [
    {
      name: "Grit the front path",
      intervalSeconds: 3 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [1 * DAY, 5 * DAY, 9 * DAY],
      notes: { 0: "nearly out of grit" },
    },
    {
      name: "Check the pipes haven't frozen",
      description: "The outside tap and the loft run.",
      intervalSeconds: 7 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [6 * DAY, 14 * DAY],
    },
    {
      name: "Fill the bird feeders",
      intervalSeconds: 3 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [1 * DAY, 4 * DAY, 7 * DAY, 10 * DAY, 13 * DAY],
    },
    {
      name: "Defrost the freezer",
      intervalSeconds: 180 * DAY,
      tags: ["kitchen", "cleaning"],
      folder: "Kitchen",
      log: [120 * DAY],
    },
    {
      name: "Check the roof after the storm",
      intervalSeconds: null,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [8 * DAY],
    },
    {
      name: "Air the house through",
      description: "Ten minutes, all the windows, even when it's grim.",
      intervalSeconds: 2 * DAY,
      tags: ["home"],
      folder: "Home",
      log: [1 * DAY, 3 * DAY, 6 * DAY, 8 * DAY],
    },
    {
      name: "Top up the screenwash and antifreeze",
      intervalSeconds: 30 * DAY,
      tags: ["car"],
      folder: "Car",
      log: [34 * DAY],
    },
    {
      name: "Winterize the garden hose",
      intervalSeconds: 365 * DAY,
      tags: ["outdoors"],
      folder: "Garden",
      log: [40 * DAY],
    },
    {
      name: "Take the vitamin D",
      intervalSeconds: 1 * DAY,
      tags: ["health"],
      folder: "Health",
      log: [8 * HOUR, 1 * DAY + 9 * HOUR, 2 * DAY + 8 * HOUR, 4 * DAY + 9 * HOUR],
    },
    {
      name: "Replace the draught excluder",
      intervalSeconds: null,
      tags: ["home"],
      folder: "Home",
      log: [],
    },
    {
      name: "Check the loft insulation",
      intervalSeconds: 365 * DAY,
      tags: ["home", "maintenance"],
      folder: "Home",
      log: [],
    },
    {
      name: "Mow the lawn",
      description: "Archived until it starts growing again.",
      intervalSeconds: 10 * DAY,
      tags: ["outdoors", "garden"],
      folder: "Garden",
      archived: true,
      log: [70 * DAY],
    },
  ],
};

/** The full sample set for a season: the year-round chores plus that season's. */
function tasksFor(season: Season): SeedTask[] {
  return [...YEAR_ROUND, ...SEASONAL[season]];
}

function seed(season: Season): DB {
  const tasks: StoredTask[] = [];
  const completions: StoredCompletion[] = [];
  let taskId = 1;
  let completionId = 1;

  for (const s of tasksFor(season)) {
    const id = taskId++;
    // Created a little before its oldest completion so timestamps stay coherent.
    const oldest = s.log.length ? Math.max(...s.log) : 0;
    tasks.push({
      id,
      name: s.name,
      description: s.description ?? "",
      intervalSeconds: s.intervalSeconds,
      colorFresh: s.colorFresh ?? null,
      colorOverdue: s.colorOverdue ?? null,
      freezeColor: s.freezeColor ?? false,
      tags: s.tags ?? [],
      folder: s.folder ?? "",
      archivedAt: s.archived ? iso(oldest + DAY) : null,
      createdAt: iso(oldest + 2 * DAY),
      updatedAt: iso(oldest + 2 * DAY),
    });
    for (const ageIdx of s.log.keys()) {
      const age = s.log[ageIdx];
      completions.push({
        id: completionId++,
        taskId: id,
        completedAt: iso(age),
        note: s.notes?.[ageIdx] ?? "",
        createdAt: iso(age),
      });
    }
  }

  return { tasks, completions, nextTaskId: taskId, nextCompletionId: completionId, seedVersion: SEED_VERSION, season };
}

// --- derivation -------------------------------------------------------------

/** Project a stored task into the API `Task` shape (with derived fields). */
function toTask(db: DB, t: StoredTask): Task {
  const mine = db.completions.filter((c) => c.taskId === t.id);
  let last: string | null = null;
  for (const c of mine) if (last == null || c.completedAt > last) last = c.completedAt;
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    intervalSeconds: t.intervalSeconds,
    colorFresh: t.colorFresh,
    colorOverdue: t.colorOverdue,
    freezeColor: t.freezeColor,
    tags: t.tags ?? [],
    folder: t.folder ?? "",
    archivedAt: t.archivedAt,
    snoozedUntil: t.snoozedUntil ?? null,
    pinned: t.pinned ?? false,
    rotate: t.rotate ?? false,
    reminderLeadSeconds: t.reminderLeadSeconds ?? null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    lastCompletedAt: last,
    completionCount: mine.length,
    // The demo is single-user: nothing is ever shared.
    ownerId: 1,
    shared: false,
    lastCompletedBy: null,
  };
}

function toCompletion(c: StoredCompletion): Completion {
  return { id: c.id, taskId: c.taskId, userId: 1, completedAt: c.completedAt, note: c.note, createdAt: c.createdAt };
}

function findTask(db: DB, id: number): StoredTask {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) throw new Error("Task not found");
  return t;
}

/** Small latency so optimistic UI / loading states are visible, as on a server. */
const tick = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 80));

// --- session ----------------------------------------------------------------

function demoUser(): User {
  let username = "demo";
  try {
    username = localStorage.getItem(USERNAME_KEY) || "demo";
  } catch {
    // ignore
  }
  return {
    id: 1,
    username,
    role: "user",
    passwordSet: true,
    oidcLinked: false,
    protected: false,
    allowShares: true,
    createdAt: iso(120 * DAY),
    updatedAt: iso(120 * DAY),
  };
}

function signedIn(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) !== "out";
  } catch {
    return true;
  }
}

function setSession(open: boolean) {
  try {
    if (open) localStorage.removeItem(SESSION_KEY);
    else localStorage.setItem(SESSION_KEY, "out");
  } catch {
    // ignore
  }
}

const DEMO_AUTH: AuthConfig = {
  localRegistration: true,
  oidc: false,
  oidcOnly: false,
  requiresApproval: false,
  lite: false,
  defaultTheme: null,
  defaultThemeEnforce: false,
  themesShareable: false,
  themesShareUsers: false,
  tasksShareable: false,
  // No server, so nothing could authenticate a bearer token — the section is
  // hidden rather than shown broken.
  apiTokens: false,
  branding: {
    name: "Taskrr",
    title: "",
    tagline: "last-done tracker",
    icon: "",
    loginHideIcon: false,
    loginHideText: false,
  },
};

const DEMO_REMINDERS: ReminderSettings = { enabled: false, webhookUrl: "", leadSeconds: 0 };

const notAvailable = (): never => {
  throw new Error("Not available in the demo.");
};

// --- the mock client --------------------------------------------------------

export const demoApi: Api = {
  // --- tasks ---
  listTasks: () => {
    const db = loadDB();
    return tick(db.tasks.map((t) => toTask(db, t)));
  },

  createTask: (input: TaskInput) => {
    const db = loadDB();
    const now = new Date().toISOString();
    const t: StoredTask = {
      id: db.nextTaskId++,
      name: input.name,
      description: input.description ?? "",
      intervalSeconds: input.intervalSeconds ?? null,
      colorFresh: input.colorFresh ?? null,
      colorOverdue: input.colorOverdue ?? null,
      freezeColor: input.freezeColor ?? false,
      tags: input.tags ?? [],
      folder: input.folder ?? "",
      archivedAt: null,
      snoozedUntil: null,
      pinned: input.pinned ?? false,
      rotate: input.rotate ?? false,
      reminderLeadSeconds: input.reminderLeadSeconds ?? null,
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.push(t);
    saveDB(db);
    return tick(toTask(db, t));
  },

  updateTask: (id: number, input: TaskInput) => {
    const db = loadDB();
    const t = findTask(db, id);
    if (input.name !== undefined) t.name = input.name;
    if (input.description !== undefined) t.description = input.description;
    if (input.intervalSeconds !== undefined) t.intervalSeconds = input.intervalSeconds;
    if (input.colorFresh !== undefined) t.colorFresh = input.colorFresh;
    if (input.colorOverdue !== undefined) t.colorOverdue = input.colorOverdue;
    if (input.freezeColor !== undefined) t.freezeColor = input.freezeColor;
    if (input.tags !== undefined) t.tags = input.tags;
    if (input.folder !== undefined) t.folder = input.folder;
    if (input.pinned !== undefined) t.pinned = input.pinned;
    if (input.rotate !== undefined) t.rotate = input.rotate;
    if (input.reminderLeadSeconds !== undefined) t.reminderLeadSeconds = input.reminderLeadSeconds;
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
  },

  snoozeTask: (id: number, untilISO: string | null) => {
    const db = loadDB();
    const t = findTask(db, id);
    // Same rule as the server: a snooze already in the past is simply over.
    t.snoozedUntil = untilISO && new Date(untilISO).getTime() > Date.now() ? untilISO : null;
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
  },

  skipTask: (id: number) => {
    const db = loadDB();
    const t = findTask(db, id);
    if (!t.intervalSeconds || t.intervalSeconds <= 0) {
      return Promise.reject(new Error("only a task with a routine has a cycle to skip"));
    }
    const projected = toTask(db, t);
    const interval = t.intervalSeconds * 1000;
    // Effective due = max(last completion + interval, current snooze).
    let due = projected.lastCompletedAt
      ? new Date(projected.lastCompletedAt).getTime() + interval
      : Date.now();
    if (t.snoozedUntil) due = Math.max(due, new Date(t.snoozedUntil).getTime());
    let next = due + interval;
    // Skipping something several cycles overdue still has to land ahead of now.
    while (next <= Date.now()) next += interval;
    t.snoozedUntil = new Date(next).toISOString();
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
  },

  pinTask: (id: number, pinned: boolean) => {
    const db = loadDB();
    const t = findTask(db, id);
    t.pinned = pinned;
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
  },

  duplicateTask: (id: number, name?: string) => {
    const db = loadDB();
    const src = findTask(db, id);
    const now = new Date().toISOString();
    // Definition only: no history, no snooze, never archived.
    const copy: StoredTask = {
      ...src,
      id: db.nextTaskId++,
      name: (name ?? "").trim() || `${src.name} (copy)`,
      archivedAt: null,
      snoozedUntil: null,
      createdAt: now,
      updatedAt: now,
    };
    db.tasks.push(copy);
    saveDB(db);
    return tick(toTask(db, copy));
  },

  deleteTask: (id: number) => {
    const db = loadDB();
    db.tasks = db.tasks.filter((t) => t.id !== id);
    db.completions = db.completions.filter((c) => c.taskId !== id);
    saveDB(db);
    return tick(undefined);
  },

  archiveTask: (id: number) => {
    const db = loadDB();
    const t = findTask(db, id);
    t.archivedAt = new Date().toISOString();
    t.updatedAt = t.archivedAt;
    saveDB(db);
    return tick(toTask(db, t));
  },

  unarchiveTask: (id: number) => {
    const db = loadDB();
    const t = findTask(db, id);
    t.archivedAt = null;
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
  },

  completeTask: (id: number, input: { note?: string; completedAt?: string }) => {
    const db = loadDB();
    findTask(db, id); // validate
    const when = input.completedAt ?? new Date().toISOString();
    const c: StoredCompletion = {
      id: db.nextCompletionId++,
      taskId: id,
      completedAt: when,
      note: input.note ?? "",
      createdAt: new Date().toISOString(),
    };
    db.completions.push(c);
    saveDB(db);
    return tick(toCompletion(c));
  },

  quickComplete: (id: number) => demoApi.completeTask(id, {}),

  listCompletions: (id: number) => {
    const db = loadDB();
    const mine = db.completions
      .filter((c) => c.taskId === id)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    return tick(mine.map(toCompletion));
  },

  deleteCompletion: (id: number) => {
    const db = loadDB();
    db.completions = db.completions.filter((c) => c.id !== id);
    saveDB(db);
    return tick(undefined);
  },

  updateCompletion: (id: number, input: { completedAt: string; note?: string }) => {
    const db = loadDB();
    const c = db.completions.find((x) => x.id === id);
    if (!c) throw new Error("Completion not found");
    c.completedAt = input.completedAt;
    c.note = input.note ?? "";
    saveDB(db);
    return tick(toCompletion(c));
  },

  listActivity: (fromISO: string, toISO: string) => {
    const db = loadDB();
    const byId = new Map(db.tasks.map((t) => [t.id, t.name]));
    const rows: Activity[] = db.completions
      .filter((c) => c.completedAt >= fromISO && c.completedAt <= toISO)
      .map((c) => ({
        completionId: c.id,
        taskId: c.taskId,
        taskName: byId.get(c.taskId) ?? "(deleted task)",
        completedAt: c.completedAt,
        note: c.note,
      }));
    return tick(rows);
  },

  // --- shared tasks (the demo is single-user, so sharing is hidden/empty) ---
  // The demo is single-user, so there is nobody to share with. authConfig
  // reports tasksShareable: false, which hides all of this in the UI.
  shareFolder: notAvailable,
  respondFolderShare: notAvailable,
  leaveFolder: notAvailable,
  unshareFolder: notAvailable,
  listFolderMembers: () => tick([]),
  listMyFolderShares: () => tick([]),
  listFolderInvites: () => tick([]),

  shareTask: notAvailable,
  respondShare: notAvailable,
  leaveTask: notAvailable,
  listMembers: () => tick([]),
  listIncomingShares: () => tick([]),
  setAllowShares: () => tick(demoUser()),

  // No server in the demo, so there's nothing to check against.
  checkLatestVersion: () => tick({ latest: "" }),

  // --- auth ---
  authConfig: () => tick(DEMO_AUTH),
  me: () => tick(signedIn() ? demoUser() : null),
  login: (username: string) => {
    setSession(true);
    try {
      if (username.trim()) localStorage.setItem(USERNAME_KEY, username.trim());
    } catch {
      // ignore
    }
    return tick(demoUser());
  },
  claim: (username: string) => demoApi.login(username, "") as Promise<User>,
  logout: () => {
    setSession(false);
    return tick(undefined);
  },
  register: (username: string) => demoApi.login(username, "") as Promise<User>,

  // --- account self-service ---
  changeUsername: (username: string) => {
    try {
      localStorage.setItem(USERNAME_KEY, username);
    } catch {
      // ignore
    }
    return tick(demoUser());
  },
  unlinkOIDC: () => tick(demoUser()),

  // --- reminders ---
  getReminders: () => tick(DEMO_REMINDERS),
  putReminders: (settings: ReminderSettings) => tick(settings),
  testReminder: () => tick({ ok: true }),

  wipeMyData: () => {
    const db = loadDB();
    const deletedTasks = db.tasks.length;
    db.tasks = [];
    db.completions = [];
    saveDB(db);
    return tick({ deletedTasks });
  },

  deleteAccount: () => {
    setSession(false);
    return tick(undefined);
  },

  changePassword: () => tick(undefined),

  // Export works for real in the demo: the data is all in the browser already,
  // so the same Blob contract is satisfied without a server. It's also the one
  // way to get your sandbox data out before "Reset demo" clears it.
  exportData: (format: "json" | "csv") => {
    const db = loadDB();
    const tasks = db.tasks.map((t) => ({
      ...toTask(db, t),
      completions: db.completions
        .filter((c) => c.taskId === t.id)
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
        .map(toCompletion),
    }));

    if (format === "csv") {
      const cell = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [
        ["task", "description", "folder", "tags", "routine_seconds", "archived", "completed_at", "note"],
      ];
      for (const t of tasks) {
        const base = [
          t.name,
          t.description,
          t.folder,
          t.tags.join(" "),
          t.intervalSeconds == null ? "" : String(t.intervalSeconds),
          t.archivedAt ? "true" : "false",
        ];
        if (t.completions.length === 0) rows.push([...base, "", ""]);
        else for (const c of t.completions) rows.push([...base, c.completedAt, c.note]);
      }
      const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
      return tick(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    }

    const doc = {
      format: "taskrr-export-v1",
      exportedAt: new Date().toISOString(),
      username: demoUser().username,
      tasks,
    };
    return tick(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
  },

  // Import works in the demo for the same reason export does: the sandbox is
  // in the browser, so a file can be restored straight into it.
  importData: (json: string, mode: "merge" | "replace") => {
    let doc: { format?: string; tasks?: unknown[] };
    try {
      doc = JSON.parse(json);
    } catch {
      return Promise.reject(new Error("could not read that file as JSON"));
    }
    if (doc.format !== "taskrr-export-v1") {
      return Promise.reject(new Error("unrecognised file (expected a taskrr-export-v1 export)"));
    }
    const incoming = Array.isArray(doc.tasks) ? doc.tasks : [];
    if (incoming.length === 0) return Promise.reject(new Error("the file contains no tasks"));

    const db = loadDB();
    let tasksDeleted = 0;
    if (mode === "replace") {
      tasksDeleted = db.tasks.length;
      db.tasks = [];
      db.completions = [];
    }
    const now = new Date().toISOString();
    const skipped: string[] = [];
    let tasksCreated = 0;
    let completionsAdded = 0;

    for (const raw of incoming as Record<string, unknown>[]) {
      const name = String(raw.name ?? "").trim();
      if (!name) {
        skipped.push("a task with no name");
        continue;
      }
      // Ids and owners in the file are ignored, exactly as the server does.
      const t: StoredTask = {
        id: db.nextTaskId++,
        name,
        description: String(raw.description ?? ""),
        intervalSeconds: typeof raw.intervalSeconds === "number" ? raw.intervalSeconds : null,
        colorFresh: typeof raw.colorFresh === "string" ? raw.colorFresh : null,
        colorOverdue: typeof raw.colorOverdue === "string" ? raw.colorOverdue : null,
        freezeColor: raw.freezeColor === true,
        tags: Array.isArray(raw.tags) ? (raw.tags as string[]).map(String) : [],
        folder: String(raw.folder ?? ""),
        archivedAt: null,
        snoozedUntil: null,
        pinned: raw.pinned === true,
        rotate: raw.rotate === true,
        reminderLeadSeconds: null,
        createdAt: now,
        updatedAt: now,
      };
      db.tasks.push(t);
      tasksCreated++;
      const completions = Array.isArray(raw.completions) ? raw.completions : [];
      for (const c of completions as Record<string, unknown>[]) {
        const at = typeof c.completedAt === "string" ? c.completedAt : "";
        if (!at || Number.isNaN(Date.parse(at))) {
          skipped.push(`a completion of ${name} had no timestamp`);
          continue;
        }
        db.completions.push({
          id: db.nextCompletionId++,
          taskId: t.id,
          completedAt: new Date(at).toISOString(),
          note: String(c.note ?? ""),
          createdAt: now,
        });
        completionsAdded++;
      }
    }
    saveDB(db);
    return tick({ mode, tasksCreated, completionsAdded, tasksDeleted, skipped });
  },

  // Bearer tokens need a server to authenticate against; the UI is gated off
  // by authConfig.apiTokens above, so these are never reached.
  listAPITokens: () => tick([]),
  createAPIToken: notAvailable,
  deleteAPIToken: notAvailable,

  getPreferences: () => {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (raw) return tick(JSON.parse(raw) as Record<string, unknown>);
    } catch {
      // ignore
    }
    return tick({});
  },

  putPreferences: (data: unknown) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(data));
    } catch {
      // ignore
    }
    return tick(undefined);
  },

  // --- admin (hidden in the demo: the account is a plain user) ---
  listUsers: notAvailable,
  adminCreateUser: notAvailable,
  adminUpdateUser: notAvailable,
  adminDeleteUser: notAvailable,
  getSettings: notAvailable,
  putSettings: notAvailable,
  adminWipe: notAvailable,
  listPending: notAvailable,
  approveUser: notAvailable,
  mergeUsers: notAvailable,
  listSessions: notAvailable,
  terminateSessions: notAvailable,
  listLogs: notAvailable,
  setDefaultTheme: () => tick(undefined),
  // No server in the demo: there are no shared themes, and the demo account
  // isn't admin, so publishing is never reached.
  listSharedThemes: () => tick([]),
  shareTheme: notAvailable,
  unshareTheme: notAvailable,
  createBackup: notAvailable,
  listBackups: notAvailable,
  backupURL: (name: string) => `#${name}`,
  deleteBackup: notAvailable,
  restoreBackup: notAvailable,
  restoreUpload: notAvailable,
};
