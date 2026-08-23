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

### 1.16.0 — the batch this roadmap planned

| Feature | Notes |
| --- | --- |
| Right-click menu | Hand-rolled rather than another dependency. Long-press on touch; behind a preference. |
| Snooze and skip | One `snoozed_until` column backs both. Skipping never writes a completion. |
| Per-task reminder lead | Coalesced over the account setting, so null keeps existing behaviour. |
| Folder sharing | Resolved at read time, so membership follows the folder. |
| Whose turn is it | Derived from member order and the last logger; nothing stored but the opt-in. |
| JSON import | Merge or replace, with nothing structural trusted from the file. |
| Pin, duplicate, quick add, tab count, web manifest | The quality-of-life batch. |

Two bugs worth remembering, both found by tests rather than by luck: the
folder grammar in quick add was ambiguous when the folder came first, and
`IntervalField` ignored its `value` prop after mount — invisible until
something other than typing tried to set a routine.

---

## Next batch

The planned batch is done. What follows is what the work itself surfaced, in
the order it seems worth doing.

### 1. An "accent on surface" colour token

The one item left open from the contrast work, and now the only known place the
app falls short of AA: in the `paper` preset the active sidebar item renders the
user's accent as text at 4.26:1 against the sidebar.

**Shape.** A `--primary-readable` token, derived with the existing
`ensureContrast()`, used wherever the accent is drawn as *text* (`text-primary`)
while `bg-primary` keeps the colour the user actually chose. The helper and its
tests already exist; this is finding the call sites and adding one token.

**Cost.** Low. **Watch for.** Doing it in the theme engine, not per component,
or the two will drift.

### 2. Undo on a completion

The accident that actually happens: quick log is one tap on a dense grid, and
undoing the wrong one means opening Manage → History → delete. This was
identified back when the trash bin was considered and dropped, and it is still
the cheaper answer to the real problem.

**Shape.** An action slot on the existing `Toast`, wired to
`deleteCompletion` for the completion the log just created.

**Cost.** Low. **Watch for.** The toast outliving the component that raised it.

### 3. Snooze and skip from the bulk bar

Snoozing exists per task and from the right-click menu, but a selection of
twelve tasks still has to be done one at a time. The bulk bar already fans out
over ids and now has the panel pattern for actions that need input.

**Cost.** Low, and it closes the gap between the two ways of acting on tasks.

### 4. Import from other trackers

`taskrr-export-v1` round-trips, which covers moving between instances. Coming
*from* something else is the harder half, and the one that decides whether
someone tries Taskrr at all.

**Shape.** A CSV importer with a column-mapping step, rather than guessing a
schema per competitor.

**Cost.** Medium, mostly UI. **Watch for.** Scope: one generic mapper, not a
per-product adapter for each tracker anyone mentions.

### 5. Rotation, one step further

Two things the derived rota deliberately cannot do, both worth having only if
people ask: skipping a member's turn without logging for them, and a fixed
order the owner can arrange rather than join order. Both mean storing state the
current design avoids, so neither is free — the point of the current version is
that nothing can drift.

### 6. Quality-of-life, still unbuilt

- **Task templates** — "new task like this one" without an existing task.
- **A service worker** — genuine offline support. A real commitment: caching,
  invalidation, and update prompts. The manifest shipped without one on purpose.
- **Per-tag colours** — tags are all one colour today.

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

- **Accent-as-text contrast** — see "Next batch" item 1. Everything else clears
  AA in all five presets.
- **No service worker** — the app is installable but not offline-capable, which
  is deliberate; see the quality-of-life list above.
