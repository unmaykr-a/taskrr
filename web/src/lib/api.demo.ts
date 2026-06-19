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
}

// Bump this when SEED below changes so existing visitors are re-seeded. The demo
// DB is disposable, so re-seeding simply replaces it with the newer sample set.
const SEED_VERSION = 2;

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
  const seeded = seed();
  saveDB(seeded);
  return seeded;
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

// A broad sample set: many tasks across several folders and tags, landing
// across fresh / due-soon / overdue / never-done, with dense history over the
// last ~30 days so the calendar and activity chart look alive. It exercises the
// per-account features a single demo user can see: cadences, tags, folders,
// notes, per-task colours, frozen colours, no-cadence streaks, and archiving.
const SEED: SeedTask[] = [
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

  // --- Outdoors ------------------------------------------------------------
  {
    name: "Mow the lawn",
    intervalSeconds: 10 * DAY,
    tags: ["outdoors", "garden"],
    folder: "Outdoors",
    log: [13 * DAY, 24 * DAY, 35 * DAY],
  },
  {
    name: "Water the outdoor plants",
    intervalSeconds: 2 * DAY,
    tags: ["outdoors", "plants", "garden"],
    folder: "Outdoors",
    log: [1 * DAY + 2 * HOUR, 3 * DAY, 5 * DAY, 7 * DAY, 9 * DAY, 11 * DAY, 13 * DAY],
  },
  {
    name: "Winterize the garden hose",
    description: "Archived until the cold comes back.",
    intervalSeconds: 365 * DAY,
    tags: ["outdoors"],
    folder: "Outdoors",
    archived: true,
    log: [190 * DAY],
  },
  {
    name: "Summer AC tune-up",
    description: "Archived for the season.",
    intervalSeconds: 365 * DAY,
    tags: ["home"],
    folder: "Outdoors",
    archived: true,
    log: [250 * DAY],
  },

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

function seed(): DB {
  const tasks: StoredTask[] = [];
  const completions: StoredCompletion[] = [];
  let taskId = 1;
  let completionId = 1;

  for (const s of SEED) {
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

  return { tasks, completions, nextTaskId: taskId, nextCompletionId: completionId, seedVersion: SEED_VERSION };
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
    t.updatedAt = new Date().toISOString();
    saveDB(db);
    return tick(toTask(db, t));
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
