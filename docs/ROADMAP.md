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

### 1.15.0

| Feature | Notes |
| --- | --- |
| Per-task statistics | Typical/longest gap, on-time rate, pace vs. routine. Derived client-side from history already fetched. |
| Activity chart range | 7d / 30d / 90d / 1y, bucketing into weeks past 120 days. |
| Keyboard shortcuts | `n`, `/`, `1`–`9`, `Esc`, `?`. |
| Bulk tag and folder | Tagging adds rather than replaces; folder is a genuine move. |
| Backdating from the calendar | Any past day; logs at noon local so a timezone shift can't slide it. |
| Per-user data export | JSON and CSV, owner-scoped. |
| API tokens | Bearer credentials scoped to tasks and completions only. |

### 1.16.0

| Feature | Notes |
| --- | --- |
| Right-click menu | Hand-rolled rather than another dependency. Long-press on touch; behind a preference. |
| Snooze and skip | One `snoozed_until` column backs both. Skipping never writes a completion. |
| Per-task reminder lead | Coalesced over the account setting, so null keeps existing behaviour. |
| Folder sharing | Resolved at read time, so membership follows the folder. |
| Whose turn is it | Derived from member order and the last logger; nothing stored but the opt-in. |
| JSON import | Merge or replace, with nothing structural trusted from the file. |
| Pin, duplicate, quick add, tab count, web manifest | The quality-of-life batch. |

### 1.17.0

| Feature | Notes |
| --- | --- |
| Accent-as-text token | `--primary-readable`, applied in the Tailwind config rather than at 40 call sites. Closes the last known AA gap. |
| Undo on a completion | An action slot on the toast, wired to the completion the log just created. |
| Bulk snooze and skip | Skip filters the selection to tasks that have a routine. |
| CSV import | One generic column mapper; produces the same document the JSON importer takes. |
| Calendar context menu and Today | The day list is tasks like any other, so it gets the same menu. |
| Demo seasons | Year-round core plus a per-season list, auto-picked by month. |

Three bugs worth remembering from this batch, all in the same 200 lines. The
right-click menu flew in across the screen because `duration-100` sets
`transition-duration` while `transition-property` defaults to `all` — so moving
it from its off-screen parking spot to the cursor was itself a transition. It
then hung off the bottom of the viewport because the edge-flip measured with
`getBoundingClientRect` while the zoom-in was still running, and read 95% of the
real height. And the theme sweep that "passed" for five presets was measuring
one preset five times, because the browser restores the theme on load and the
harness never checked what it had actually applied.

---

## Next batch

### 1. Per-tag colours

Tags are all one colour. A colour per tag is the cheapest remaining win for
anyone whose list has grown past a screenful, and the tag input already has the
picker component it would need.

**Cost.** Low. **Watch for.** Contrast — a user-chosen tag colour drawn as text
needs the same treatment the accent just got, which is now a helper rather than
a research problem.

### 2. Task templates

"New task like this one" without needing an existing task to duplicate. Falls
out of duplicate, which already does the copy-without-history part.

**Cost.** Low-medium, mostly deciding where templates live and whether they sync.

### 3. Rotation, one step further

Two things the derived rota deliberately cannot do: skipping a member's turn
without logging for them, and a fixed order the owner arranges rather than join
order. Both mean storing state the current design avoids, and the point of the
current version is that nothing can drift — so this stays parked until somebody
actually asks.

### 4. A service worker

Genuine offline support. A real commitment: caching, invalidation, and update
prompts, on an app that currently has no cache to get stale. The manifest
shipped without one on purpose, and that is still the right call until someone
wants Taskrr on a phone with no signal.

### 5. Import, the rest of it

The CSV mapper covers name, description, folder, tags, cadence and last-done —
one row, one task. It does not read a column of *history*, which is what a
tracker being migrated from actually has. Worth doing only if someone turns up
with a file like that; the shape would be a second mapping mode keyed on a task
identifier, and that is a lot of UI for a case nobody has reported yet.

---

## Deliberately not doing

Recorded so the same suggestions don't get relitigated every few months.

| Idea | Why not |
| --- | --- |
| Subtasks, dependencies, per-instance due dates | This is the to-do app Taskrr exists not to be. The whole pitch is that these aren't to-dos. |
| Built-in SMTP / email reminders | Real config surface, a dependency, and deliverability pain. The webhook already reaches ntfy, Gotify, Apprise, Discord and Home Assistant. |
| Comments or threads on tasks | Notes on completions already carry this weight. |
| Server-side search | Client-side filtering is comfortable far past any realistic personal list. |
| A trash / recycle bin | Considered and dropped. Archive already covers "hide but keep", and `DeleteTask` is only destructive for a sole owner — a member leaves, and an owner with members transfers. Undo on a completion turned out to be the cheaper answer to the accident that actually happens, and it shipped in 1.17.0. |
| A per-product importer for each tracker | One generic CSV mapper, not an adapter per competitor. Every one of those is a schema to track forever. |
| Native mobile apps | The web UI is responsive and a PWA manifest gets most of the benefit. |

---

## Known open items

- **No service worker** — the app is installable but not offline-capable, which
  is deliberate; see the next batch.
- **The demo guesses the northern hemisphere** — a first visit picks its season
  from the month, which is wrong for half the world. The banner's season picker
  is the escape hatch; detecting it properly needs a timezone-to-hemisphere
  guess that would be wrong in its own ways.
