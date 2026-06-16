# Users and Authentication

Taskrr supports multiple users, each with their own private tasks and history.
Sign-in is by local username and password, by OIDC single sign-on, or both.

## The bootstrap admin

On first start a single admin account is created (`TASKRR_ADMIN_USERNAME`,
default `admin`). If you did not preset a password, you set it in the browser on
the first sign-in. This account is protected - other admins cannot edit or delete
it, and it always keeps password sign-in as a break-glass path. See
[Configuration](Configuration).

## Sessions

A successful sign-in creates a session stored as a hashed token in a cookie.
Sessions last `TASKRR_SESSION_TTL` (default `720h`) and **slide** - they renew
while in use. Set `TASKRR_COOKIE_SECURE=true` when serving over HTTPS. Admins can
see and terminate active sessions from the admin area.

Sign-in is rate limited both per username and per source IP, so neither a focused
account attack nor a password-spray across many usernames runs unbounded. For the
per-IP limiter to see the real address behind a proxy, keep
`TASKRR_TRUST_PROXY_HEADERS=true` (see [Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS)).

## Roles

There are two roles:

- **admin** - full access to the admin area (users, settings, backups, sessions,
  logs, themes).
- **user** - their own tasks, account, reminders, and shares.

Admins manage roles from the admin area. There is always at least one admin.

## Registration controls

Self-registration is off by default and controlled by admin settings:

- **Local registration** (`reg_local`) - allow username/password self sign-up.
- **OIDC auto-provision** (`reg_oidc`) - create a user automatically on first
  successful OIDC login.
- **Approval queue** (`reg_approval`) - local sign-ups need admin approval before
  they can sign in; pending users appear in the admin area to approve or deny.

These live in the [Admin Guide](Admin-Guide).

## Account self-service

Every signed-in user can, from their account settings:

- Change their **username**.
- Change their **password**.
- Connect or disconnect **OIDC** (link/unlink the SSO identity).
- Manage **reminders** (see [Reminders](Reminders)).
- Opt in or out of receiving **task shares** (see [Shared Tasks](Shared-Tasks)).
- **Wipe my data** - delete their own tasks and history while keeping the account.
- **Delete account** - remove the account entirely.

## Lite mode

Set `TASKRR_LITE=true` for a single-person instance. This turns off the
multi-user surface: self-registration and creating extra accounts are disabled,
and the Users section of the admin area is hidden. You still sign in normally; it
just removes everything to do with managing other people.

## Merging accounts

If someone ends up with two accounts (for example a local account and a separate
OIDC one), an admin can **merge** them: data can be moved from the source to the
target, and the source is removed. This is handy when migrating users onto SSO.

## See also

- [OIDC Single Sign-On](OIDC-Single-Sign-On) - full SSO setup and role mapping.
- [Admin Guide](Admin-Guide) - registration settings, approvals, and user
  management.
