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

## Filters and bulk actions

The sidebar offers filter views with live counts:

- **All** - everything active.
- **Due soon** - has a routine and is approaching its due time.
- **Overdue** - past its due time.
- **Never done** - no completions yet.
- **Archived** - soft-archived tasks (see below).

Select several tasks to run a **bulk action**: log, archive, restore, or delete
them together, with a confirmation that states the count.

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
- An **activity chart** summarises your completions over the last 30 days.

## See also

- [Shared Tasks](Shared-Tasks) - sharing a task with another user.
- [Reminders](Reminders) - a webhook nudge when a task is due.
- [Theming and Branding](Theming-and-Branding) - colours and the overall look.
