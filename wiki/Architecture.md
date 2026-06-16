# Architecture

Taskrr is deliberately small: one Go binary that embeds the web UI and a pure-Go
SQLite database, with no external services. This page explains how the pieces fit
together.

## Big picture

- **Backend (Go).** A single statically linked binary (`CGO_ENABLED=0`) using
  pure-Go SQLite (`modernc.org/sqlite`). Routing is the standard library
  (`net/http` with Go 1.22+ method patterns) - no web framework. Handlers depend
  on small store interfaces, which are the seam for swapping the data layer.
- **Frontend (React + TypeScript + Vite).** Tailwind CSS and shadcn/ui
  components, with TanStack Query for data fetching. It is built and embedded into
  the binary with `go:embed`, so there is nothing to serve separately.
- **Storage.** A single SQLite file under `./data`. Completions are an
  append-only log; a task's routine is a nullable interval column.

## Layout

```
cmd/taskrr/        entrypoint
internal/config/   environment configuration
internal/store/    SQLite data layer + SQL migrations
internal/api/      HTTP handlers, store interfaces, SPA serving
internal/auth/     password hashing + session tokens + secret cipher
internal/reminder/ the webhook reminder loop
internal/web/      go:embed of the built frontend
web/               the React/TypeScript/Vite frontend (source)
```

## Request flow

1. A request hits the `net/http` mux defined in `internal/api/server.go`.
2. Middleware adds security headers, access logging, and resolves the session
   cookie to a user.
3. The handler validates input and calls a store method through one of the
   interfaces (`TaskStore`, `AuthStore`, `ShareStore`). Every task/completion
   method is scoped by the acting user's id, so a request can only reach its own
   data (or a task shared with and accepted by it).
4. Anything not matched by an `/api` route falls through to the embedded SPA.

## The store interfaces

`internal/api/server.go` defines the data surface the HTTP layer needs as Go
interfaces. The concrete `*store.Store` (SQLite) satisfies them, and tests supply
fakes. New data-layer work goes behind these interfaces, which keeps transport
concerns decoupled from the database.

## Data model notes

- **Tasks** carry a name, description, optional routine (`interval_seconds`),
  colours, tags, and a folder, owned by a user.
- **Completions** are append-only - each row records when, an optional note, and
  who logged it. "Time since" and staleness derive from the latest completion.
- **Sharing** keeps a task a single row and attaches members via a
  `task_shares` table (pending/accepted), rather than duplicating the task.
- **Reminders** are tracked per recipient so collaborators are nudged
  independently.

## Migrations

Schema changes are SQL files under `internal/store/migrations/`, named
`NNNN_name.sql`. They run in filename order on start and are recorded in a
`schema_migrations` table so each runs exactly once. Applied migrations are never
edited; new changes are new files.

## Conventions

- Timestamps are RFC 3339 UTC text in the database; the Go layer owns the format.
  JSON is camelCase to match the frontend client.
- Tunable UI policy (staleness colours/thresholds, filter views) lives in
  `web/src/lib/` and is unit-tested, separate from components.
- Versioning is semantic; the single source of truth is `web/package.json`,
  surfaced in the app as the version label and the in-app changelog.

## Security posture (summary)

- Strict security headers and a tight Content-Security-Policy on every response;
  HSTS over HTTPS.
- Per-username and per-IP sign-in rate limiting.
- Session tokens stored hashed.
- The reminder webhook client blocks SSRF to internal addresses and does not
  follow redirects (see [Reminders](Reminders)).
- The OIDC client secret can be encrypted at rest with `TASKRR_SECRET_KEY`.

For a deeper dive, read the source - it is compact and commented. The
[Development and Contributing](Development-and-Contributing) page covers building
and testing.
