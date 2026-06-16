# FAQ and Troubleshooting

## General

### What is Taskrr for?

Tracking recurring things by **how long it's been** since you last did them, not
by deadline - chores, maintenance, anything cyclical. See
[Tasks and Routines](Tasks-and-Routines).

### How much does it need to run?

Roughly 12 MB of RAM at idle and under half a percent of one CPU core. It runs on
a Raspberry Pi (`arm64`) or any small box.

### Where is my data?

In a single SQLite file under `./data` (`TASKRR_DB_PATH`). Backing up or moving
the instance is copying that folder. See [Backups and Restore](Backups-and-Restore).

## Sign-in and accounts

### I forgot the admin password.

The bootstrap admin keeps password sign-in even in OIDC-only mode. If you set
`TASKRR_ADMIN_PASSWORD` or `TASKRR_ADMIN_PASSWORD_HASH` in the environment, that
value applies. You can also generate a fresh hash and set it (see
[Configuration](Configuration)).

### Sign-in keeps getting rejected / rate limited.

Sign-in is rate limited per username and per source IP (to blunt brute force and
password-spraying). Wait a few minutes and try again. Behind a proxy, make sure
`TASKRR_TRUST_PROXY_HEADERS=true` so the limiter sees the real client IP rather
than the proxy's.

### My session keeps dropping / cookie not sticking.

Over HTTPS, set `TASKRR_COOKIE_SECURE=true` so the cookie is issued correctly as
Secure. See [Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS).

## OIDC

### OIDC login fails at the callback.

Check that the redirect URL matches exactly on both sides - it should be your
public origin plus `/api/auth/oidc/callback`. Confirm the issuer URL, client id,
and secret. See [OIDC Single Sign-On](OIDC-Single-Sign-On).

### A user signed in with OIDC but got a brand-new account.

By default OIDC identities are separate accounts. Turn on **Link by username**
(`oidc_link_username`) to link a first OIDC sign-in to a matching local account,
or use the admin **merge** action to combine two accounts.

### OIDC users are not being created.

Turn on **OIDC auto-provision** (`reg_oidc`) so a user is created on first
successful OIDC login.

### An admin lost their admin role after signing in with OIDC.

Group membership syncs the role for SSO-managed accounts. An admin role granted
locally (the account has a password) is never stripped; only accounts whose role
is governed by OIDC are demoted when they leave the admin group.

## Reminders

### The test webhook works but reminders never fire.

Only tasks with a routine and at least one completion can be due. Confirm the
task has an interval and has been logged at least once, and that the recipient has
reminders enabled with a webhook. The loop checks every
`TASKRR_REMINDER_INTERVAL` (default `1m`).

### My webhook to a local service is refused.

The client blocks loopback, link-local, multicast, and cloud-metadata addresses,
and does not follow redirects. Private/LAN addresses (`192.168.x.x`, `10.x.x.x`)
are allowed - point at the LAN IP of your ntfy / Home Assistant rather than
`localhost`. See the security section of [Reminders](Reminders).

## Files and Docker

### The files in ./data are owned by the wrong user.

The container runs as uid/gid `1000` by default. Set `TASKRR_UID` / `TASKRR_GID`
to match your user. See [Installation](Installation).

### How do I update?

`docker compose pull && docker compose up -d`. Migrations run automatically. There
is no in-app auto-update; the changelog's "Check for updates" is informational
only.

## Sharing

### I do not see any share controls.

Sharing is an admin-gated feature (`tasks_shareable`). An admin must enable
**Task sharing** first. It is also unavailable in the in-browser demo. See
[Shared Tasks](Shared-Tasks).

## Demo

### Can I try it without installing?

Yes - the [live demo](https://unmaykr-a.github.io/taskrr/) runs entirely in your
browser against a mock API. The admin area, SSO, backups, and reminder delivery
need a real server, so they are not in the demo.

## Still stuck?

Open an issue on [GitHub](https://github.com/unmaykr-a/taskrr/issues).
