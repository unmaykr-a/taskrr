# Taskrr

**A self-hosted tracker for when you last did things.**

I kept forgetting the same handful of chores — not because I'd missed a
deadline, but because I had no idea how long it had been. Watering the plants,
cleaning the dehumidifier filter, backing up the NAS, descaling the kettle.
None of those are to-dos. A to-do list either nags you or fills up with things
you did last week and can't tick off again.

So Taskrr tracks the one thing that actually matters for that kind of chore:
how long since the last time. You make a task once, hit **Quick log** whenever
you do it, and the card counts up. Give it a routine — "every 2 weeks" — and it
shades from green to red as the next one comes due.

One ~12 MB binary with the web UI and SQLite baked in. It idles at about 12 MB
of memory and well under half a core, which is the whole reason it exists in
this shape: mine runs on a Pi in a cupboard next to everything else.

![Tasks with staleness colours, the month calendar, and the activity chart](docs/screenshots/overview.png)

The interface is themeable down to the colours, the fonts, the animated
background and your own wallpaper, from a floating settings window:

![The theme customiser](docs/screenshots/theme.png)

## Live demo

**[Try Taskrr in your browser →](https://unmaykr-a.github.io/taskrr/)**

The real UI with a mock API behind it, seeded with sample tasks and history and
saved to local storage. Every visitor gets their own sandbox and there's a
"Reset demo" button when you've made a mess of it. The sample list changes with
the season, and you can switch seasons from the banner. Anything that needs a
real server — the admin area, SSO, backups, reminder delivery — isn't in it.

## Running it

```yaml
services:
  taskrr:
    image: ghcr.io/unmaykr-a/taskrr:latest
    restart: unless-stopped
    user: "1000:1000"
    ports: ["8787:8787"]
    environment:
      TASKRR_DB_PATH: /data/taskrr.db
    volumes:
      - ./data:/data
```

That's genuinely all of it. There's a fuller
[`docker-compose.yml`](./docker-compose.yml) in the repo with a healthcheck and
an optional `.env` if you'd rather start from that.

Sign in as `admin` and set the password on first run, or preset it with
`TASKRR_ADMIN_PASSWORD` (or `_HASH` — `.env.example` has a one-liner for
generating one). Everything lives in the mounted directory as a single SQLite
file, so backing it up or moving it to another box is `cp -r`.

Two things that catch people out:

- **It writes as uid 1000.** The image drops privileges, so the mounted
  directory has to be writable by whoever you run it as, and `user:` has to
  match. This is the one I get asked about most.
- **Set `TASKRR_COOKIE_SECURE=true` behind TLS.** Session cookies aren't marked
  Secure by default because the default assumption is `http://` on a LAN. If
  you're proxying it with a certificate, flip it.

Images are `linux/amd64` and `linux/arm64`, and every released version stays
pullable, so pin a tag if you'd rather not ride `:latest`. I don't publish
prebuilt binaries — if you want one without Docker, `make build` gives you a
single static `bin/taskrr` with everything inside it.

## What it does

- One-tap logging, or pick a time and add a note. History is editable, and a
  stray log has an **Undo** on the toast rather than a trip through the history
  window. Backdate straight from the calendar by clicking a day.
- Right-click anything (long-press on a phone) for the whole menu — log, snooze,
  skip, pin, duplicate, archive, delete. The calendar's day list too.
- Snooze until later, or skip a cycle, which moves the next due date on without
  pretending you did it. Both work across a whole selection.
- Routines with due dates: cards shade continuously from fresh to overdue, with
  a progress bar and "due in 3d". The colours are yours, per task and globally.
- A month calendar of what you did and what's coming, plus an activity chart
  over 7 days, 30 days, 90 days or a year.
- Per-task statistics: how often you *actually* do a thing, your longest gap,
  and how that squares with the routine you said you'd keep.
- Filters with live counts — all, due soon, overdue, never done, snoozed,
  archived — plus folders in the sidebar to narrow any of them. Bulk actions
  over a selection (log, snooze, skip, routine, tag, folder, archive, delete),
  and pinning for the ones that should stay on top whatever the sort.
- Tags with search, filtering and an optional colour each, folders, sorting by
  name or last-done, and templates for the setups you reuse.
- Multiple users with per-user data, local passwords, and optional OIDC SSO
  (I've tested Authentik and Pocket ID) including group-to-admin mapping.
  `TASKRR_LITE=true` hides the whole multi-user surface if you're the only one.
- Share a single task, or a whole folder so anything you put in it later comes
  along. Optional "whose turn is it" rota, per-user opt-out, and an admin switch
  for the feature as a whole.
- An admin area in the UI: users, registration with an approval queue, active
  sessions, live logs, backups with one-click restore, instance settings, and
  branding down to which of three layouts the sign-in page uses.
- Webhook reminders when something's due — ntfy, Gotify, Apprise, Home
  Assistant, a Discord webhook, anything that takes JSON. Lead time is global
  with a per-task override.
- API tokens for the other direction: log a task from a script, an NFC tag or an
  automation. A token reaches tasks and history and nothing else — not the admin
  area, not your password. Revoke one or all of them at once; changing your
  password revokes them too.
- Export everything as JSON or CSV. Import a JSON export back, or bring a CSV
  from another tracker and match up the columns.
- Themeable: colour customiser with palette generation, light and dark, animated
  backgrounds, a wallpaper of your own (or one set for the whole instance),
  frosted glass, per-animation toggles, a sidebar that folds away, and panels
  that either float as windows or behave as plain full-screen menus. Every
  contrast pair clears WCAG AA in all five presets, whatever accent you pick.
- Keyboard shortcuts (`?` for the list) with rebindable keys, quick-add syntax
  (`water plants every 2 weeks #home`), installable to a phone home screen, and
  a preference to switch off anything above that isn't for you.

## Configuration

All environment variables; [`.env.example`](./.env.example) documents each one
with working examples. The ones that matter:

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_ADDR` | `:8787` | Listen address |
| `TASKRR_DB_PATH` | `./data/taskrr.db` | SQLite file (directory is created) |
| `TASKRR_ADMIN_USERNAME` | `admin` | Bootstrap admin, created on first start |
| `TASKRR_ADMIN_PASSWORD` | — | Its password; unset means you choose one on first sign-in |
| `TASKRR_ADMIN_PASSWORD_HASH` | — | Pre-hashed alternative; wins over the plaintext |
| `TASKRR_SESSION_TTL` | `720h` | Session length; sessions slide while in use |
| `TASKRR_COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `TASKRR_TRUST_PROXY_HEADERS` | `true` | Take the client IP from proxy headers; `false` if Taskrr is exposed directly |
| `TASKRR_SECRET_KEY` | — | Encrypts the OIDC client secret at rest, so it isn't sitting in plaintext in your backups |
| `TASKRR_LITE` | `false` | Single-person mode: no registration, no extra accounts |
| `TASKRR_EXPERIMENTAL` | `false` | Offer the experimental flat interface styles |
| `TASKRR_REMINDER_INTERVAL` | `1m` | How often the reminder loop looks for due tasks |
| `TASKRR_SAFETY_BACKUP` | `true` | Snapshot before a restore, so a mistaken restore is undoable |
| `TASKRR_UPDATE_CHECK_URL` | project package.json | Where the admin update check looks; empty disables it |
| `TASKRR_OIDC_*` | — | Issuer, client id/secret, redirect URL — also editable later in the admin UI |

## Building from source

Go 1.25+ and Node 22+:

```bash
git clone https://github.com/unmaykr-a/taskrr.git
cd taskrr
make build           # frontend + backend -> bin/taskrr
./bin/taskrr         # :8787, data in ./data
```

`make dev-backend` and `make dev-frontend` in two terminals for development,
`make test` for both suites, `make install-hooks` for the pre-commit gate,
`make docker` to build the image.

```
cmd/taskrr/          entrypoint
internal/config/     env configuration
internal/store/      SQLite data layer + migrations
internal/api/        HTTP routing + handlers
internal/auth/       password hashing + session tokens
internal/reminder/   the webhook reminder loop
internal/web/        go:embed of the built frontend
web/                 the React/TypeScript frontend
```

Issues and pull requests are welcome. If something's broken on your setup I'd
rather hear about it than not.

## License

[MIT](./LICENSE)
