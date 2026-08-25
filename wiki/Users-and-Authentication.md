# Users and Authentication

Taskrr supports multiple users, each with their own private tasks and history.
Sign-in is by local username and password, by OIDC single sign-on, or both.

## The bootstrap admin

On first start a single admin account is created (`TASKRR_ADMIN_USERNAME`,
default `admin`). If you did not preset a password, the server prints a one-time
setup link in its log - open that to choose one. A fresh link is printed on every
start until the account has a password, so a missed one is never a lockout. This account is protected - other admins cannot edit or delete
it, and it always keeps password sign-in as a break-glass path. See
[Configuration](Configuration).

## Sessions

A successful sign-in creates a session stored as a hashed token in a cookie.
Sessions last `TASKRR_SESSION_TTL` (default `720h`) and **slide** - they renew
while in use. Set `TASKRR_COOKIE_SECURE=true` when serving over HTTPS. Admins can
see and terminate active sessions from the admin area.

Sign-in is rate limited both per username and per source IP, so neither a focused
account attack nor a password-spray across many usernames runs unbounded. For the
per-IP limiter to see the real address behind a proxy, leave
`TASKRR_TRUST_PROXY_HEADERS` at its default `auto` (see
[Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS)).

## Roles

There are two roles:

- **admin** - full access to the admin area (users, settings, backups, sessions,
  logs, themes).
- **user** - their own tasks, account, reminders, and shares.

Admins manage roles from the admin area. There is always at least one admin.

## Adding an account: invitations

An admin can create an account with a password and tell the person what it is,
or - more usually - leave the password blank. Leaving it blank produces an
**invitation link**, shown once at the moment the account is created. Send that
link to the person however you already talk to them; opening it lets them choose
their own password and signs them straight in.

A few things about the link:

- It works **once**, and lapses after **seven days**.
- Setting the password spends it. So does an admin setting a password on that
  account by hand.
- The secret travels in the URL's `#fragment`, which browsers never send to a
  server - so it stays out of proxy access logs on the way in, and the sign-in
  page removes it from the address bar as soon as it is used.
- Issuing a new link retires the previous one. Use the **invite link** button
  beside an account in the admin area for a link that ran out, never arrived, or
  belongs to an account made before invitations existed.

An account with no password and no usable link cannot be signed into at all
until an admin issues one. That is deliberate: the invitation, not knowledge of
the username, is what sets the password. Usernames are meant to be known - they
show up on shared tasks and in folder members - so an account waiting to be set
up would otherwise be claimable by anyone who could guess the name.

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
- Change their **password** - which signs their other devices out and revokes
  their API tokens.
- Connect or disconnect **OIDC** (link/unlink the SSO identity).
- Manage **reminders** (see [Reminders](Reminders)).
- Opt in or out of receiving **task shares** (see [Shared Tasks](Shared-Tasks)).
- Mint and revoke **API tokens**, one at a time or all at once
  (see [API Reference](API-Reference#api-tokens)).
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
