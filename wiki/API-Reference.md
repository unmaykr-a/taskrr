# API Reference

Taskrr is a single Go binary that serves a JSON API under `/api` and the embedded
single-page app for everything else. This page lists the HTTP endpoints. There is
no separate API token scheme - the API uses the same session cookie as the web UI.

## Conventions

- **Base path:** all endpoints are under `/api`.
- **Auth:** a session cookie established by sign-in. Endpoints are grouped below
  by who may call them.
- **JSON:** request and response bodies are JSON, camelCase (matching
  `web/src/lib/api.ts`). Timestamps are RFC 3339 in UTC.
- **Ownership:** task and completion endpoints are scoped to the signed-in user;
  you can only touch data you own or a task shared with and accepted by you.

## Health and auth (public)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness check. |
| GET | `/api/auth/config` | Public auth/branding config for the login page. |
| GET | `/api/auth/me` | The current user, or unauthenticated. |
| POST | `/api/auth/login` | Sign in with username and password. |
| POST | `/api/auth/claim` | Claim the bootstrap admin by setting its first password. |
| POST | `/api/auth/logout` | End the current session. |
| POST | `/api/auth/register` | Self-registration (when enabled). |
| GET | `/api/auth/oidc/login` | Begin OIDC sign-in. |
| GET | `/api/auth/oidc/link` | Begin linking OIDC to the signed-in account. |
| GET | `/api/auth/oidc/callback` | OIDC redirect target. |

## Account self-service (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/me/username` | Change username. |
| POST | `/api/me/password` | Change password. |
| DELETE | `/api/me/oidc` | Unlink OIDC identity. |
| GET | `/api/me/preferences` | Get the per-user preferences blob. |
| PUT | `/api/me/preferences` | Replace the preferences blob. |
| GET | `/api/me/reminders` | Get reminder settings. |
| PUT | `/api/me/reminders` | Update reminder settings. |
| POST | `/api/me/reminders/test` | Send a test webhook. |
| GET | `/api/me/shares` | List incoming share requests. |
| PUT | `/api/me/allow-shares` | Set the share opt-in/out. |
| POST | `/api/me/wipe` | Delete the user's own tasks and history. |
| DELETE | `/api/me` | Delete the account. |

## Tasks and completions (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/tasks` | List visible tasks (owned plus accepted shares). |
| POST | `/api/tasks` | Create a task. |
| GET | `/api/tasks/{id}` | Get one task. |
| PATCH | `/api/tasks/{id}` | Update a task (owner only). |
| POST | `/api/tasks/{id}/archive` | Archive a task. |
| POST | `/api/tasks/{id}/unarchive` | Restore an archived task. |
| DELETE | `/api/tasks/{id}` | Delete (member leaves; owner delete transfers or removes). |
| POST | `/api/tasks/{id}/complete` | Log a completion. |
| GET | `/api/tasks/{id}/completions` | List a task's completions. |
| PATCH | `/api/completions/{id}` | Edit a completion (owner or author). |
| DELETE | `/api/completions/{id}` | Delete a completion (owner or author). |
| GET | `/api/activity` | Completion activity over a date range. |

## Sharing (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/tasks/{id}/share` | Invite a user to a task (owner). |
| POST | `/api/tasks/{id}/share/respond` | Accept or decline an invite. |
| POST | `/api/tasks/{id}/leave` | Leave a shared task. |
| GET | `/api/tasks/{id}/members` | List a task's members. |

## Version

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/version/latest` | Latest released version (informational). |

## Themes

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/themes/shared` | List admin-published shared themes. |

## Admin (admin only)

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/admin/users` | List users. |
| POST | `/api/admin/users` | Create a user. |
| PATCH | `/api/admin/users/{id}` | Update a user (role, username, password). |
| DELETE | `/api/admin/users/{id}` | Delete a user. |
| GET | `/api/admin/pending` | List users awaiting approval. |
| POST | `/api/admin/users/{id}/approve` | Approve a pending user. |
| POST | `/api/admin/merge` | Merge two accounts. |
| GET | `/api/admin/sessions` | List active sessions. |
| DELETE | `/api/admin/sessions/{id}` | Terminate sessions. |
| GET | `/api/admin/logs` | Tail the in-memory server/access logs. |
| GET | `/api/admin/settings` | Get instance settings. |
| PUT | `/api/admin/settings` | Update instance settings. |
| PUT | `/api/admin/default-theme` | Set the site default theme. |
| POST | `/api/admin/shared-themes` | Publish a shared theme. |
| DELETE | `/api/admin/shared-themes/{name}` | Unshare a theme. |
| POST | `/api/admin/wipe` | Wipe (scope per request body). |
| POST | `/api/admin/backup` | Create a backup. |
| GET | `/api/admin/backups` | List backups. |
| GET | `/api/admin/backups/{name}` | Download a backup. |
| DELETE | `/api/admin/backups/{name}` | Delete a backup. |
| POST | `/api/admin/restore/{name}` | Restore from a listed backup. |
| POST | `/api/admin/restore-upload` | Restore from an uploaded file. |

## SPA fallback

Any path not matched above is served from the embedded single-page app.

> The route list is defined in
> [`internal/api/server.go`](https://github.com/unmaykr-a/taskrr/blob/main/internal/api/server.go);
> if you are extending the API, that file and `web/src/lib/api.ts` are the two
> ends to keep in sync (see [Development and Contributing](Development-and-Contributing)).
