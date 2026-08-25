# API Reference

Taskrr is a single Go binary that serves a JSON API under `/api` and the embedded
single-page app for everything else. This page lists the HTTP endpoints. Calls
authenticate either with the web UI's session cookie or with an API token (see
[API tokens](#api-tokens) below).

## Conventions

- **Base path:** all endpoints are under `/api`.
- **Auth:** a session cookie established by sign-in, or `Authorization: Bearer
  <token>` for an API token. Endpoints are grouped below by who may call them.
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
| GET | `/api/me/export` | Download your own data. `?format=csv` for CSV, JSON by default. |
| POST | `/api/me/import` | Restore a `taskrr-export-v1` document. `?mode=merge` (default) or `?mode=replace`. CSV import is a conversion in the browser, not a separate endpoint - it posts the same document. |
| GET | `/api/me/folder-shares` | Folders you have shared out. |
| GET | `/api/me/folder-invites` | Folder invitations waiting for you. |
| GET | `/api/me/tokens` | List your API tokens (metadata only). |
| POST | `/api/me/tokens` | Mint a token. The response is the only time the value is returned. |
| DELETE | `/api/me/tokens/{id}` | Revoke a token. |
| DELETE | `/api/me/tokens` | Revoke every token you hold. Returns `{"revoked": n}`. |
| GET | `/api/me/backgrounds` | Your uploaded background images (metadata only). |
| POST | `/api/me/backgrounds` | Upload one, as multipart with a `file` field. |
| DELETE | `/api/me/backgrounds/{id}` | Delete one of your own. |

## API tokens

A token is a long-lived bearer credential for automation - a shell script, an
NFC tag, a Home Assistant automation. Create one under **Settings -> Account ->
API tokens**; the value is shown once and only its SHA-256 digest is stored, so
a database or backup leak yields nothing usable.

```bash
curl -H "Authorization: Bearer $TASKRR_TOKEN" https://taskrr.example.com/api/tasks
curl -H "Authorization: Bearer $TASKRR_TOKEN" -X POST \
     https://taskrr.example.com/api/tasks/7/complete
```

Tokens are deliberately narrower than a session. They reach only:

- `/api/tasks/...` and `/api/completions/...`
- `/api/activity`, `/api/auth/me`, `/api/me/shares`, `/api/me/export`, `/api/health`

Anything else - the admin area, changing your password or username, deleting the
account, minting further tokens - returns `403` and needs a real sign-in. A
leaked token can therefore log and edit tasks, but cannot take over the instance
or lock its owner out.

Administrators can turn the feature off for the whole instance under **Settings
-> Admin -> Accounts and sharing**. Doing so stops new tokens being created;
tokens that already exist keep working until they are revoked, so flipping the
switch never silently breaks a live automation.

### Revoking

Revoke a single token from its row under **Settings -> Account -> API tokens**,
or use **Revoke every token** when more than one exists - the option for when
you think a token has leaked and don't know which of them it is.

Tokens are also revoked automatically:

- when you change your password (which already signs out your other devices), and
- when an admin terminates an account's sessions under **Settings -> Admin ->
  Active sessions**, or resets its password.

A bearer credential outlives a cookie, so the two go together: signing a browser
out while leaving a token working would only be half of shutting an account off.

## Background images

A picture behind the app. Uploads are stored in the database and are owner-only:
`GET /api/backgrounds/{id}` serves the bytes to whoever owns the image, and to
anyone at all - signed out included - when it is the instance background, which
is what lets the login page show it. The current instance background's id is in
`branding.background` on `/api/auth/config` (0 = none).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/backgrounds/{id}` | The image itself. Owner-only unless it is the instance background. |

The type is decided by the file's own bytes, not by the `Content-Type` a client
sends: PNG, JPEG, WebP, AVIF and GIF are accepted and anything else is a `400`.
SVG is deliberately not on the list - it can carry script, and these bytes are
served back to other people. Responses carry `X-Content-Type-Options: nosniff`.

Limits are 8 MB per image and 40 MB per account; over either is a `413`. The
image currently set as the instance background answers `409` on delete until an
admin clears it, so the login page can't lose its background to a tidy-up.

## Data export

`GET /api/me/export` returns every task you own or share, each with its full
history, scoped to the signed-in account:

- **JSON** (default) - `{"format":"taskrr-export-v1","exportedAt":...,"username":...,"tasks":[...]}`,
  each task carrying a `completions` array. Keeps the structure for moving an
  account elsewhere.
- **CSV** (`?format=csv`) - one row per completion, with the task's name,
  description, folder, tags, routine and archived flag repeated on each row. A
  task with no history still gets a row, so nothing is silently dropped. A cell
  that begins with `=`, `+`, `-` or `@` is written with a leading apostrophe,
  which spreadsheets read as literal text rather than a formula to run; the
  apostrophe isn't displayed. Names on a task shared with you were chosen by
  someone else, so this isn't only about what you typed yourself.

Both are sent as downloads with a dated filename. Admin backups (whole-database,
admin-only) remain the right tool for restoring an instance; this is the
per-user equivalent for taking your own data with you.

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

## Task scheduling (authenticated, owner only)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/tasks/{id}/snooze` | Hold a task back. Body `{"until": "<RFC3339>"}`; empty clears it. |
| POST | `/api/tasks/{id}/skip` | Move the next due date on by one routine, logging nothing. |
| POST | `/api/tasks/{id}/pin` | Pin or unpin. Body `{"pinned": true|false}`. |
| POST | `/api/tasks/{id}/duplicate` | Copy the definition (not the history). Body `{"name": "..."}` optional. |

Snoozing and skipping share one field, `snoozedUntil`: a task's effective due
time is the later of (last completion + routine) and that. Skipping is the same
value computed one routine past the current due time, so a skip never writes a
completion - the calendar, the activity chart and the per-task statistics all
treat a completion as "you actually did this".

## Sharing (authenticated)

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/tasks/{id}/share` | Invite a user to a task (owner). |
| POST | `/api/tasks/{id}/share/respond` | Accept or decline an invite. |
| POST | `/api/tasks/{id}/leave` | Leave a shared task. |
| GET | `/api/tasks/{id}/members` | List a task's members. |
| DELETE | `/api/tasks/{id}/members/{userId}` | Remove a member (owner). |

## Folder sharing (authenticated)

Sharing a folder covers every task the owner keeps in it, including ones created
or moved there afterwards - and moving a task out takes the access back. It is
resolved when tasks are read, not expanded into per-task shares, so membership
always matches where the tasks actually are. Gated by the same
`tasks_shareable` setting as per-task sharing.

The folder name is a path segment, so escape it once (`encodeURIComponent`).

| Method | Path | Description |
| --- | --- | --- |
| POST | `/api/folders/{folder}/share` | Invite a user. Body `{"username": "..."}`. |
| POST | `/api/folders/{folder}/share/respond` | Accept or decline. Body `{"ownerId": 1, "accept": true}`. |
| POST | `/api/folders/{folder}/leave` | Leave a folder shared with you. Body `{"ownerId": 1}`. |
| DELETE | `/api/folders/{folder}/members/{userId}` | Remove a member (owner). |
| GET | `/api/folders/{folder}/members` | Who is on one of your own folders. `404` if you have no such folder. |

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
