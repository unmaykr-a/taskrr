# Configuration

Everything is configured through environment variables. Every value has a
sensible default, so an unconfigured instance still starts. The canonical,
commented list is
[`.env.example`](https://github.com/unmaykr-a/taskrr/blob/main/.env.example);
this page explains each variable in more depth.

When using Docker Compose, put these in a `.env` file next to the compose file.

> Compose treats a single `$` as variable interpolation. Any value containing a
> `$` (notably a hashed password or an OIDC secret) must have each `$` doubled to
> `$$` in the `.env` file.

## Core

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_ADDR` | `:8787` | Listen address. Use `127.0.0.1:8787` to bind to loopback only (for example, behind a proxy on the same host). |
| `TASKRR_DB_PATH` | `./data/taskrr.db` | Path to the SQLite file. The parent directory is created if missing. |
| `TASKRR_SESSION_TTL` | `720h` | How long a sign-in lasts (a Go duration such as `720h`, `30m`). Sessions slide - they extend while in use. |
| `TASKRR_LITE` | `false` | Single-person mode. Disables self-registration and the ability to create extra accounts. See [Users and Authentication](Users-and-Authentication). |
| `TASKRR_REMINDER_INTERVAL` | `1m` | How often the reminder loop wakes to check for due tasks. See [Reminders](Reminders). |

## The bootstrap admin

On first start, a single admin account is created so you can sign in.

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_ADMIN_USERNAME` | `admin` | Username of the bootstrap admin created on first start. |
| `TASKRR_ADMIN_PASSWORD` | - | Its password. Leave unset to choose one in the browser on the first sign-in. |
| `TASKRR_ADMIN_PASSWORD_HASH` | - | A pre-computed hash, used instead of the plaintext password (the hash wins if both are set). |

The bootstrap admin is **protected**: other admins cannot edit or delete it, and
it keeps password sign-in even in OIDC-only mode, so a provider outage can never
lock you out (the break-glass path).

### Generating a password hash

You can avoid putting a plaintext password in your `.env` by precomputing a hash.
The built-in helper prints one (already `$$`-escaped for a Compose `.env`):

```bash
docker compose run --rm taskrr -hash-password 'your-password' | sed 's/[$]/$$/g'
```

The format is `pbkdf2-sha256$<iterations>$<salt>$<key>`.

## Security and proxying

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_COOKIE_SECURE` | `false` | Set `true` when served over HTTPS so the session cookie is marked Secure. |
| `TASKRR_TRUST_PROXY_HEADERS` | `true` | Read the client IP from reverse-proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`) for rate limiting and logs. Set `false` if Taskrr is exposed directly, so those headers cannot be spoofed to dodge the per-IP rate limiter. |
| `TASKRR_SECRET_KEY` | - | Encrypts the OIDC client secret at rest, so it is never stored - or included in downloadable backups - in plaintext. Any string; keep it secret and stable. Changing it makes an existing stored secret unreadable, so you would re-enter it. |

See [Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS) for how these fit
together. In short: HSTS is sent automatically over HTTPS, either directly
(`TASKRR_COOKIE_SECURE=true`) or via a trusted proxy reporting
`X-Forwarded-Proto: https`.

## Backups and updates

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_SAFETY_BACKUP` | `true` | Take an automatic snapshot of the database right before a restore, so a mistaken restore is undoable. Set `false` to stop the backups folder collecting a safety snapshot on every restore. |
| `TASKRR_UPDATE_CHECK_URL` | project `package.json` | The source the changelog's admin-only "Check for updates" reads to report the latest released version. It is informational only - it never updates the app. Set empty to disable the check entirely. |

## OIDC single sign-on

These can also be set later in the admin UI; environment values seed the initial
configuration. A secret containing `$` needs each one doubled to `$$`.

| Variable | What it does |
| --- | --- |
| `TASKRR_OIDC_ISSUER` | The issuer URL, for example `https://auth.example.com/application/o/taskrr/`. |
| `TASKRR_OIDC_CLIENT_ID` | The OAuth client id. |
| `TASKRR_OIDC_CLIENT_SECRET` | The OAuth client secret (encrypted at rest when `TASKRR_SECRET_KEY` is set). |
| `TASKRR_OIDC_REDIRECT_URL` | The callback URL, your public origin plus `/api/auth/oidc/callback`. |

Full details, including group-to-admin-role mapping and OIDC-only mode, are in
[OIDC Single Sign-On](OIDC-Single-Sign-On).

## Container user (Docker)

The compose file honours two extra variables for file ownership of the `./data`
bind mount:

| Variable | Default | What it does |
| --- | --- | --- |
| `TASKRR_UID` | `1000` | uid the container process runs as. |
| `TASKRR_GID` | `1000` | gid the container process runs as. |

## Settings stored in the database

Beyond environment variables, many instance options live in the database and are
edited from the admin UI rather than the environment - registration controls,
the shared-tasks gate, theme sharing, branding, and the OIDC settings above.
These are documented in the [Admin Guide](Admin-Guide).
