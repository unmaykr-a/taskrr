# Tasks and Routines

A task in Taskrr is a recurring thing you want to keep track of - not a one-off
to-do. The core idea is **how long it's been since you last did it**.

## Logging a completion

Each time you do the thing, log a completion:

- **Quick log** records "done, now" in one tap.
- **Advanced log** lets you pick a date and time and add a note - useful for
  backfilling something you did yesterday, or recording context.

Completions are an append-only history. The card counts up from the most recent
one ("3 days ago"), and the most recent completion drives the staleness colour.

Logged the wrong thing? The confirmation that appears has an **Undo** on it,
which removes the completion you just made and puts the task back exactly as it
was. It is there for a few seconds; after that, the history in the Manage window
is where a stray log gets fixed.

### Editing history

History is editable. Any logged completion can be changed (its time or note) or
deleted later, so a mis-tap is easy to fix. On a [shared task](Shared-Tasks),
each completion records who logged it, and the card shows who logged last; a
completion can be edited by the task owner or by whoever logged it.

## Routines (cadence) and due dates

Give a task a routine - "every 2 weeks", "every 3 days" - and Taskrr treats it as
having a due time: the last completion plus the interval.

- The card shades **continuously from fresh (green) to overdue (red)** as the due
  time approaches and passes.
- A progress bar and a "due in 3d" / "overdue by 2d" label show where it stands.
- Tasks with no routine simply age; they show time-since but are never "due".

The exact colours and thresholds are tunable (see
[Theming and Branding](Theming-and-Branding)). The colour logic lives in the
frontend and is unit-tested; cadence and due-date maths are deterministic.

### Per-task colours and freezing

You can override the fresh and overdue colours per task. A task can also have its
colour **frozen**, so it stays at its recent colour instead of fading over time -
handy for things you want to keep visually calm. There is also a global "fade
colours over time" preference that applies the same idea to every task at once.

## Organising larger lists

As the list grows, three tools keep it tidy:

- **Tags** - attach labels to tasks, then filter with the search box or by
  clicking a tag chip.
- **Folders** - assign a task to a folder, and optionally switch on a grouping
  mode that collapses the list into a section per folder.
- **Sorting** - order by name, or by most / least recently done, from the
  toolbar.

## Snoozing and skipping

Two ways to say "not now", both of which stop a task counting as due and stop
its reminders until they run out:

- **Snooze** holds a task back for a while - an hour, tomorrow, three days, a
  week, or a date you pick in its Manage window. It shows as "Snoozed" and
  appears in its own sidebar view.
- **Skip this cycle** moves the next due date on by one routine. It is *not* a
  completion: nothing is added to the history, and the calendar, activity chart
  and task statistics are all untouched. Skipping something several cycles
  overdue still lands in the future rather than in the past.

Both are on the right-click menu; the Manage window adds an exact date and a
"wake up now" for a snoozed task. Both are also in the bulk bar, so a selection
can be put off in one go - skipping only touches the tasks in the selection that
actually have a routine, and tells you how many that was.

## Pinning and duplicating

- **Pin to top** keeps a task first whatever the list is sorted by.
- **Duplicate** copies a task's setup - description, routine, tags, folder,
  colours - into a new task. It deliberately does not copy the history, since
  the copy has not been done yet.

## The right-click menu

Right-click any task card (or long-press on a touchscreen) for everything you
can do to it: log it, snooze or skip, pin, duplicate, archive, delete. The same
menu is on the tasks listed under an open day in the calendar. It is
keyboard-navigable, and turning it off under **Settings -> Preferences ->
Shortcuts & input -> Right-click menu** gives you your browser's own menu back -
which is what you want for copying a task name.

## Quick add

Typing a new task's name, you can describe it in the same breath:

```
water plants every 2 weeks #home /Kitchen
```

Taskrr reads the routine, the tags and the folder out of it and *offers* the
interpretation under the box; one click fills the fields in. It never applies
silently, and a plain name is left completely alone. Folders with spaces need
quoting: `/"Front Garden"`.

Turn it off under **Settings -> Preferences -> Shortcuts & input -> Quick add**.

## Filters and bulk actions

The sidebar offers filter views with live counts:

- **All** - everything active.
- **Due soon** - has a routine and is approaching its due time.
- **Overdue** - past its due time.
- **Never done** - no completions yet.
- **Snoozed** - deliberately put off until later (see above).
- **Archived** - soft-archived tasks (see below).

Select several tasks to run a **bulk action**: log, add a tag, move them to a
folder, archive, restore, or delete them together, with a confirmation that
states the count for the destructive one.

Bulk tagging *adds* to whatever each task already has rather than replacing its
tags, so tagging a mixed selection never quietly wipes the tags on some of them.
Moving to a folder is a genuine move; leaving the folder box empty takes the
selection out of any folder.

## Archiving vs deleting

- **Archiving** soft-hides a task and its history without losing anything; it
  moves to the Archived filter and can be restored at any time.
- **Deleting** removes the task. For [shared tasks](Shared-Tasks) deletion is
  non-destructive for collaborators - a member who deletes simply leaves, and an
  owner deleting a task that still has members transfers ownership to the
  earliest member so the history is never lost.

## Calendar and activity

- A **month calendar** shows what you did on each day and what is coming up
  (upcoming due dates for routine tasks).
- Clicking any **past day** opens it, and you can log a task straight onto that
  day without opening the task first - the quickest way to record something you
  did yesterday. Future days only open when something is scheduled for them.
- The tasks listed under an open day carry the same right-click menu the cards
  do, so you can act on something the moment you spot it there.
- **Today** takes you back to the current month with today open, however far you
  have wandered.
- An **activity chart** summarises your completions over 7 days, 30 days, 90
  days or a year. The range follows your account. A year groups into weeks so
  the shape stays readable in a narrow panel.

## Task statistics

A task's Manage window shows what its history says about it, once there are at
least two completions:

- **Typically every** - the median gap between completions. The median rather
  than the average, so one holiday or one burst of catching up does not redefine
  what normal looks like for the task.
- **Logged** - how many times, and since when.
- **Longest gap** - the worst it has slipped.
- **On time** - with a routine, the share of gaps that came in within it.

With a routine there is also a one-line verdict: whether you run ahead of it,
right on it, or behind. A task with exactly two completions has only one gap,
which is a measurement rather than a pattern, so it shows a reduced panel and no
verdict.

Turn the whole panel off under **Settings -> Preferences -> Layout -> Task statistics**.

## Keyboard shortcuts

Press <kbd>?</kbd> for the list. Single keys, no modifiers, and never while you
are typing in a field:

| Key | Action |
| --- | --- |
| <kbd>n</kbd> | New task |
| <kbd>/</kbd> | Focus the search box |
| <kbd>1</kbd>-<kbd>9</kbd> | Switch to that sidebar view |
| <kbd>Esc</kbd> | Clear search, tag filter and selection |
| <kbd>?</kbd> | Show the shortcut list |

Turn them off under **Settings -> Preferences -> Shortcuts & input -> Keyboard shortcuts**.

## See also

- [Shared Tasks](Shared-Tasks) - sharing a task with another user.
- [Reminders](Reminders) - a webhook nudge when a task is due.
- [Theming and Branding](Theming-and-Branding) - colours and the overall look.
- [API Reference](API-Reference#api-tokens) - API tokens and data export.
