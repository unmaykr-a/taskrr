# Taskrr

**A self-hosted tracker for when you last did things.**

Some things aren't really to-dos. Watering the plants, cleaning the dehumidifier
filter, backing up the NAS, descaling the kettle - what matters isn't a deadline,
it's *how long it's been*. Taskrr is built around exactly that: create a task
once, tap **Quick log** each time you do it, and the card counts up from there.
Give a task a routine ("every 2 weeks") and it shades from green to red as the
next one comes due.

The whole app is one small binary with the web UI and SQLite database baked in.
It idles at roughly 12 MB of memory and under half a percent of one CPU core, so
it runs happily on a Raspberry Pi or any small box you already have.

## Try it first

The [live demo](https://unmaykr-a.github.io/taskrr/) is the real UI with no
backend - it runs against an in-browser mock of the API, seeded with sample data
and saved to your browser's local storage. There's no account and no server.
The admin area, single sign-on, backups, and reminder delivery need a real
server, so they aren't part of the demo.

## Where to start

- New here? [Installation](Installation) gets you running with Docker in a
  couple of minutes, then sign in as `admin`.
- Tuning the instance? [Configuration](Configuration) documents every
  environment variable, and [Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS)
  covers the public-facing setup.
- Day-to-day use is in [Tasks and Routines](Tasks-and-Routines),
  [Shared Tasks](Shared-Tasks), and [Reminders](Reminders).
- Running it for other people? See the [Admin Guide](Admin-Guide),
  [Users and Authentication](Users-and-Authentication), and
  [Backups and Restore](Backups-and-Restore).

## Feature overview

- One-tap logging, or pick a time and add a note. History is editable, a stray
  log has an Undo on the confirmation, and you can backdate straight from the
  calendar.
- Right-click any task (long-press on a phone) for everything you can do to it.
- Snooze a task until later, or skip a cycle - which moves the next due date on
  without recording that you did it. Both work on a whole selection.
- Routines with due dates: cards shade continuously from fresh to overdue, with
  a progress bar and "due in 3d" on each card. Colours are customisable per task
  and globally.
- A month calendar of what you did and what's coming up, plus an activity chart
  over 7 days, 30 days, 90 days or a year.
- Per-task statistics: how often you actually do a thing, your longest gap, and
  how that compares to the routine you set.
- Filters with live counts - all, due soon, overdue, never done, snoozed,
  archived - bulk actions over a selection, and pinning for the ones that should
  stay at the top.
- Tags with search and a tag filter, folder grouping, and sorting by name or
  last-done.
- Multiple users with per-user data, local password login, and optional OIDC
  single sign-on with group-to-admin-role mapping. A lite mode turns the
  multi-user surface off for solo use.
- Share a single task, or a whole folder so anything you add to it later is
  included. Optional "whose turn is it" rota.
- An admin area: user management, registration controls with an approval queue,
  active sessions, live server logs, backups with one-click restore, branding
  including the sign-in page layout, and instance settings.
- Reminders via webhook when a task is due - ntfy, Gotify, Apprise, Home
  Assistant, a Discord webhook, or anything that accepts JSON. Lead time is
  global with a per-task override.
- API tokens so a script, an NFC tag or a home automation can log a task. A
  token reaches tasks and history only.
- Export everything as JSON or CSV, restore a JSON export, or bring a CSV from
  another tracker and match up the columns.
- A themeable interface: colour customiser with palette generation, light and
  dark modes, animated backgrounds, frosted glass, and per-animation toggles.
  Panels float as windows by default and can be switched to plain full-screen
  menus. Works well on a phone.
- Keyboard shortcuts with rebindable keys, quick-add syntax
  ("water plants every 2 weeks #home"), and installable to a phone home screen.

## License

Taskrr is released under the [MIT License](https://github.com/unmaykr-a/taskrr/blob/main/LICENSE).
If it is useful to you, you can [support development on Ko-fi](https://ko-fi.com/unmaykr).
