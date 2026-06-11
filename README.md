# Taskrr

**A self-hosted tracker for when you last did things.**

Some things aren't really to-dos. Watering the plants, cleaning the
dehumidifier filter, backing up the NAS, descaling the kettle — what matters
isn't a deadline, it's *how long it's been*. Taskrr is built around exactly
that: create a task once, tap **Quick log** each time you do it, and the card
counts up from there. Give a task a routine ("every 2 weeks") and it shades
from green to red as the next one comes due.

The whole app is one ~12 MB binary with the web UI and SQLite database baked
in. It idles at a few megabytes of memory and effectively zero CPU, so it runs
happily in the corner of a Raspberry Pi or any small box you already have.

## Quick start

All you need is Docker and the compose file — no cloning, no building:

```bash
mkdir taskrr && cd taskrr
curl -LO https://raw.githubusercontent.com/andri1305/taskrr/main/docker-compose.yml
mkdir data
docker compose up -d
```

Open <http://localhost:8787> and sign in as `admin` — you'll be asked to set a
password on the first sign-in. Your data lives in the plain `./data` folder
next to the compose file; backing up or moving the instance is copying that
folder.

> The container writes as uid/gid 1000 by default (a typical single-user Linux
> box). If `id -u` says otherwise, set `TASKRR_UID` / `TASKRR_GID`.

To preset the admin password or configure anything else up front, drop a
`.env` file next to the compose file — [`.env.example`](./.env.example)
documents every option.

## Features

- One-tap logging, or pick a time and add a note. History is editable — every
  logged completion can be changed or undone later.
- Routines with due dates: cards shade continuously from fresh to overdue,
  with a progress bar and "due in 3d" on each card. Colours are customisable
  per task and globally.
- A month calendar of what you did and what's coming up, plus an activity
  chart of your last 30 days.
- Filters with live counts: all, due soon, overdue, never done, archived —
  and bulk actions (log / archive / delete several at once).
- Multiple users with per-user data, local password login, and optional OIDC
  single sign-on (tested with Authentik), including group-to-admin-role
  mapping. A lite mode turns the multi-user surface off for solo use.
- An admin area in the UI: user management, registration controls with an
  approval queue, active sessions, live server logs, backups with one-click
  restore, and instance settings.
- Reminders via webhook when a task is due — point it at ntfy, Gotify,
  Apprise, Home Assistant, a Discord webhook, or anything that accepts JSON.
- A themeable interface: colour customiser with palette generation, light and
  dark modes, animated backgrounds, frosted glass, floating windows, and
  per-animation toggles. Works well on a phone.

## Configuration

Everything is environment variables — `.env.example` documents each one with
working examples. The short version:

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_ADDR` | `:8787` | Listen address |
| `TASKRR_DB_PATH` | `./data/taskrr.db` | SQLite file (directory is created) |
| `TASKRR_ADMIN_USERNAME` | `admin` | Bootstrap admin, created on first start |
| `TASKRR_ADMIN_PASSWORD` | — | Its password; leave unset to choose one on first sign-in |
| `TASKRR_ADMIN_PASSWORD_HASH` | — | Pre-hashed alternative; wins over the plaintext |
| `TASKRR_SESSION_TTL` | `720h` | Session length; sessions slide while in use |
| `TASKRR_COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `TASKRR_TRUST_PROXY_HEADERS` | `true` | Read the client IP from proxy headers; set `false` if Taskrr is exposed directly |
| `TASKRR_LITE` | `false` | Single-person mode: disables registration and extra accounts |
| `TASKRR_REMINDER_INTERVAL` | `1m` | How often the reminder loop checks for due tasks |
| `TASKRR_OIDC_*` | — | Issuer, client id/secret, redirect URL — also editable later in the admin UI |

Running behind a reverse proxy with HTTPS is the intended setup for anything
beyond your own LAN: set `TASKRR_COOKIE_SECURE=true` there.

## Building from source

Needs Go 1.25+ and Node 22+:

```bash
git clone https://github.com/andri1305/taskrr.git
cd taskrr
make build           # frontend + backend -> bin/taskrr
./bin/taskrr         # serves on :8787, data in ./data
```

For development: `make dev-backend` and `make dev-frontend` in two terminals,
`make test` for the test suites, `make install-hooks` for the pre-commit gate,
and `make docker` to build the image locally.

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

## License

[MIT](./LICENSE)
