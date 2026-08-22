# Roadmap

Where Taskrr goes next, and — just as importantly — where it doesn't.

The constraint every item below is judged against: **Taskrr is a tracker for how
long it's been since you did something, not a to-do app.** A ~12 MB single
binary that idles at ~12 MB of RAM on a Raspberry Pi. A feature earns its place
by making "am I keeping up?" easier to answer, without adding a dependency, a
config surface, or a concept the app has to keep explaining.

---

## Shipped

For context on what the next batch builds against.

| Feature | Notes |
| --- | --- |
| Per-task statistics | Typical/longest gap, on-time rate, pace vs. routine. Derived client-side from history already fetched; behind the **Task statistics** preference. |
| Activity chart range | 7d / 30d / 90d / 1y, persisted per account. Buckets into weeks past 120 days so a year stays legible in a narrow panel. |
| Keyboard shortcuts | `n`, `/`, `1`–`9`, `Esc`, `?`. Behind the **Keyboard shortcuts** preference. |
| Bulk tag and folder | Added to the existing multi-select bar. Tagging adds rather than replaces; folder is a genuine move. |
| Backdating from the calendar | Any past day opens a task picker; logs at noon local so a timezone shift can't slide the entry a day. |
| Per-user data export | JSON and CSV, owner-scoped. Works in the demo too, since its data is already in the browser. |
| API tokens | Bearer credentials scoped to tasks and completions only. Admin switch, on by default. |

---

## Next batch

Ordered by value per line of code. The first two are the ones worth doing first.

### 1. Snooze and skip a cycle

**The gap.** There's no way to say "I'm away for two weeks" or "skip this one".
`freezeColor` only pins the colour — cadence, due dates, reminders and filters
keep running, so you come home to a wall of red and reminders you can't act on.

**Shape.**
- A nullable `snoozed_until` on `tasks`, respected in `lib/staleness.ts` and in
  the reminder loop's due query.
- A **Skip this cycle** action that advances the due date by one interval
  *without* logging a completion. This matters: skipping must not pollute
  history with a completion that never happened, or the new per-task stats start
  lying.
- Card affordance: a small "snoozed until X" line replacing the due phrase.

**Cost.** One migration, one column, a handful of call sites. Low.

**Watch for.** Snooze interacts with reminders — a snoozed task must not fire
one. That's the part to get right, and the reminder dedup table is already keyed
per `(task_id, user_id)`, so it has somewhere to hang.

### 2. JSON import

**The gap.** Export shipped without its other half, so the migration story is
one-directional. `taskrr-export-v1` was versioned precisely so an importer could
read it.

**Shape.** `POST /api/me/import` taking an export document; create tasks and
completions under the calling account, never trusting ids or owner fields from
the file. Offer merge (add to what's there) vs. replace (wipe first, behind the
same re-type-your-username confirmation the danger zone already uses).

**Cost.** Medium — validation is most of it. Reuse `taskRequest.toInput()` so
imported tasks go through exactly the same clamps as created ones.

**Watch for.** This is an untrusted-input path that writes to the database. Cap
the body size, cap task and completion counts, and reject unknown `format`
values rather than guessing.

### 3. Per-task reminder overrides

**The gap.** Reminders are one webhook and one lead time per *account*. "A day
before the NAS backup, an hour before the bins" isn't expressible.

**Shape.** A nullable `lead_seconds` on the task, falling back to the user's
setting. Surfaces as one extra row in the Manage window's routine section.

**Cost.** Low. The per-user reminder table and the delivery loop already exist;
this is a coalesce in one query and a field in one form.

### 4. Share a folder, not a task

**The gap.** Sharing is per-task and invite-based. A household with a "Home"
folder of fifteen chores means fifteen invitations, and every new chore needs
another one.

**Shape.** Share a folder name with a user; tasks in it inherit membership, and
a task moved into the folder picks it up. Existing per-task shares stay as they
are — this is an additional, coarser grain, not a replacement.

**Cost.** Medium. The membership model is per-task today, so folder shares need
either expansion at share time (simple, but drifts when tasks move) or
resolution at read time (correct, but touches every visibility query). Prefer
resolution at read time and accept the query cost.

**Watch for.** The single most likely source of a data-visibility bug in the
whole roadmap. Worth writing the store tests before the handler.

### 5. Whose turn is it

**The gap.** `lastCompletedBy` is already stored and shown. On a shared chore
the obvious next question — who's up — isn't answered.

**Shape.** An opt-in rotation on a shared task: members in order, "Next up:
Alice" on the card, advancing on each completion. No assignment, no enforcement,
no notifications; just a hint.

**Cost.** Low-medium, and genuinely differentiating — very little else in this
niche does household rotation well.

### 6. Quality-of-life batch

Small, independent, each worth doing on a quiet afternoon:

- **Duplicate a task** — one action in the Manage window.
- **Pin a task** to the top of the list, independent of sort.
- **Quick-add parsing** — `water plants every 2 weeks #home` in the name field,
  parsed into cadence and tags with a live preview of what it understood.
- **Due-today count in the tab title** — a browser-tab badge for a pinned tab.
- **PWA manifest** — installable on a phone home screen. Manifest and icons
  only; an offline service worker is a much bigger commitment and is *not*
  included here.

---

## Deliberately not doing

Recorded so the same suggestions don't get relitigated every few months.

| Idea | Why not |
| --- | --- |
| Subtasks, dependencies, per-instance due dates | This is the to-do app Taskrr exists not to be. The whole pitch is that these aren't to-dos. |
| Built-in SMTP / email reminders | Real config surface, a dependency, and deliverability pain. The webhook already reaches ntfy, Gotify, Apprise, Discord and Home Assistant. |
| Comments or threads on tasks | Notes on completions already carry this weight. |
| Server-side search | Client-side filtering is comfortable far past any realistic personal list. |
| A trash / recycle bin | Considered and dropped. Archive already covers "hide but keep", and `DeleteTask` is only destructive for a sole owner — a member leaves, and an owner with members transfers. A second soft-delete concept would cost more in explanation than it saves. An undo affordance on *completions* is the cheaper answer to the accident that actually happens. |
| Native mobile apps | The web UI is responsive and a PWA manifest gets most of the benefit. |

---

## Known open items

Small things noticed but not yet fixed.

- **Accent-as-text contrast.** In the `paper` preset the active sidebar item
  renders the user's accent as text at 4.26:1 against the sidebar, just under
  AA. Fixing it properly means a separate "accent on surface" token, because the
  same colour also fills buttons where clamping it would change the look the
  user chose. Everything else clears AA in all five presets.
