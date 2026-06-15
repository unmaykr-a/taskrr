// releases.ts — the in-app changelog data. Kept terse and curated (separate
// from the developer CHANGELOG.md) so the version menu and the post-update
// "what's new" dialog can render it with per-change icons.
//
// To add a release: bump the version in web/package.json and prepend one entry
// to RELEASES below. That is the only maintenance step — releases.test.ts fails
// if the top entry does not match the current version, so it can't be forgotten,
// and the what's-new dialog derives "changes since version X" from this list
// (any gap, e.g. 1.10.1 -> 1.15.7, shows every release in between).

declare const __APP_VERSION__: string;

export type ChangeKind = "feature" | "fix";

export interface Change {
  text: string;
  kind: ChangeKind;
  /** Optional grey explanation shown after the change as "- ...". */
  note?: string;
}

export interface Release {
  version: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  changes: Change[];
}

// `typeof` guard so this never throws if the define is absent (e.g. a test
// runner without Vite's replacement); the real build always substitutes it.
export const CURRENT_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";

const feat = (text: string, note?: string): Change => ({ text, kind: "feature", note });
const fix = (text: string, note?: string): Change => ({ text, kind: "fix", note });

// Newest first. Keep the headline short; put the explanation in the note.
export const RELEASES: Release[] = [
  {
    version: "1.12.0",
    date: "2026-06-15",
    changes: [
      feat(
        "Reminders for shared tasks",
        "Members of a shared task now get their own due reminders (if they've set a webhook), not just the owner — each reminded independently.",
      ),
      fix(
        "Shared badge",
        "A task is marked shared only once an invite is accepted; a pending invite alone no longer badges it.",
      ),
    ],
  },
  {
    version: "1.11.0",
    date: "2026-06-15",
    changes: [
      feat(
        "Shared tasks",
        "Share a task with another user so you both see and log it, with who-logged-last tracked. Owners invite by username; members can leave. Admins enable it under Admin settings.",
      ),
      feat(
        "Requests and opt-out",
        "Incoming shares wait under a Requests view to accept or decline, and you can opt out of receiving shares in your account settings.",
      ),
      feat(
        "Tags",
        "Label a task with one or more tags, then click a tag chip (or use search) to filter the list. Manage tags in the task's dialog.",
      ),
      feat("Search", "A search box filters tasks by name, description, or tag as you type."),
      feat("Sorting", "Order the list by name, most or least recently done, or newest, from the toolbar."),
      feat(
        "Folders",
        "Give a task a folder, then turn on Group in the toolbar to collapse the list into a section per folder.",
      ),
      feat(
        "In-app changelog",
        "The version number in the sidebar opens this changelog and shows each release's date.",
      ),
      feat(
        "What's new on update",
        "After an update you get a one-off summary of everything that changed since you last opened the app.",
      ),
      feat(
        "Update check",
        "Admins can check whether a newer version has been released. It only reports what's available and never updates the app itself.",
      ),
    ],
  },
  {
    version: "1.10.0",
    date: "2026-06-14",
    changes: [
      feat(
        "Instance branding",
        "Admins can set the app's name, browser-tab title, tagline, and icon under Admin settings.",
      ),
    ],
  },
  {
    version: "1.9.0",
    date: "2026-06-14",
    changes: [
      feat("Toasts", "Brief confirmations appear for common actions; turn them off in your preferences."),
    ],
  },
  {
    version: "1.8.0",
    date: "2026-06-14",
    changes: [
      feat("Calendar month/year picker", "Jump the calendar to any month or year from its header."),
      feat("User theme sharing", "Admins can let regular users publish their saved themes to everyone, not just admins."),
    ],
  },
  {
    version: "1.7.0",
    date: "2026-06-13",
    changes: [
      feat(
        "Custom date picker",
        "A built-in date and time picker, with its own preferences, used when logging or editing completions.",
      ),
      feat("Pop-out logs", "Admins can pop the server log view out into its own window."),
      feat(
        "Colour-fade toggle",
        "Turn off a task's fade to overdue when you only care that it was done, not how long ago.",
      ),
    ],
  },
  {
    version: "1.6.0",
    date: "2026-06-13",
    changes: [
      feat("Per-account themes", "Your theme follows your account across devices, and admins can force a default for everyone."),
      fix("Theme kept on logout", "Signing out no longer discards your customised theme."),
    ],
  },
  {
    version: "1.5.0",
    date: "2026-06-13",
    changes: [
      feat(
        "Safety backups",
        "A backup is taken automatically just before a restore, so a mistaken restore can be undone. Toggle it with TASKRR_SAFETY_BACKUP.",
      ),
      feat("Versioned images", "Container images are published per release, not just as latest."),
    ],
  },
  {
    version: "1.4.0",
    date: "2026-06-12",
    changes: [
      feat("OIDC-only sign-in", "Admins can require single sign-on and hide the password login."),
      feat("Wipe everything", "A true reset that clears all data while keeping the acting admin signed in."),
    ],
  },
  {
    version: "1.3.0",
    date: "2026-06-12",
    changes: [
      feat(
        "Encrypted OIDC secret",
        "The OIDC client secret is encrypted at rest when TASKRR_SECRET_KEY is set, so it isn't stored or backed up in plaintext.",
      ),
      feat("HSTS behind TLS", "The server sends HSTS when served over HTTPS through a trusted proxy."),
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-11",
    changes: [feat("Follows your clock", "Time and date formatting follow your device's locale by default.")],
  },
  {
    version: "1.1.0",
    date: "2026-06-11",
    changes: [
      feat(
        "Browser demo",
        "A no-backend demo of the whole app that runs entirely in your browser, behind the public demo site.",
      ),
    ],
  },
  {
    version: "1.0.0",
    date: "2026-06-11",
    changes: [
      feat(
        "First public release",
        "Last-done tracking with routines, a calendar, multiple users, OIDC, backups, reminders, and a themeable UI.",
      ),
    ],
  },
];

function parts(v: string): number[] {
  return v.split(".").map((n) => parseInt(n, 10) || 0);
}

/** Negative if a < b, zero if equal, positive if a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function currentRelease(): Release | undefined {
  return RELEASES.find((r) => r.version === CURRENT_VERSION);
}

/** Releases strictly newer than `version` (drives the what's-new dialog). */
export function releasesSince(version: string): Release[] {
  return RELEASES.filter((r) => compareVersions(r.version, version) > 0);
}

/** Format an ISO release date for display (parsed as local midnight). */
export function formatReleaseDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
