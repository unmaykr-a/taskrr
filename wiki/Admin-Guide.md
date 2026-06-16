# Admin Guide

Admins get an in-app admin area covering users, instance settings, sessions,
logs, backups, and themes. This page is an overview of what lives there; several
topics have their own dedicated pages.

## Users

- List, create, edit, and delete users; change roles (admin / user).
- The bootstrap admin is protected - it cannot be edited or deleted by other
  admins.
- **Merge** two accounts into one (optionally moving data), useful when migrating
  someone onto SSO.
- In [lite mode](Users-and-Authentication) the Users section is hidden.

## Registration and approvals

Self-registration is off by default. The relevant settings:

- **Local registration** (`reg_local`) - allow username/password self sign-up.
- **OIDC auto-provision** (`reg_oidc`) - create a user on first OIDC login.
- **Approval required** (`reg_approval`) - new local sign-ups wait for admin
  approval. Pending users appear in a queue to **approve** or **deny**.

See [Users and Authentication](Users-and-Authentication).

## Single sign-on (OIDC)

Configure the issuer, client id/secret, redirect URL, the admin group, username
linking, and OIDC-only mode. Full details and provider notes are in
[OIDC Single Sign-On](OIDC-Single-Sign-On).

## Shared tasks

The **Task sharing** gate (`tasks_shareable`) turns the whole shared-tasks
feature on or off for the instance. While off, the share UI is hidden and the
server refuses new shares. See [Shared Tasks](Shared-Tasks).

## Themes (instance-wide)

- **Set as site default** - publish a theme as the instance default, shown even
  on the signed-out login page (`default_theme`).
- **Use the default for everyone** (`default_theme_enforce`) - accounts that have
  not customised their own theme follow the site default and pick up changes. The
  moment a user changes their theme, theirs wins - it is a default, not a lock.
- **Allow sharing themes** (`themes_shareable`) - lets admins publish saved
  themes to all users; **Let everyone share** (`themes_share_users`) additionally
  lets non-admins publish.

See [Theming and Branding](Theming-and-Branding).

## Branding

Customise the instance identity (admin settings): name, browser tab title,
tagline, an uploaded icon, and toggles to hide the icon or name/tagline on the
login card. Branding is applied even when signed out. Details in
[Theming and Branding](Theming-and-Branding).

## Sessions

View all active sessions and **terminate** them - for a single user or in bulk.
Useful after a password change or to revoke a lost device.

## Live logs

A live tail of the server and access logs is available in the admin area, and can
be **popped out** as a floating window so you can watch it while changing
settings. Webhook URLs are stripped from reminder failure messages here.

## Backups and restore

Create, download, delete, and one-click restore database backups, or restore from
an uploaded file. A safety snapshot is taken before each restore by default. This
has its own page: [Backups and Restore](Backups-and-Restore).

## Wipe everything

A destructive admin action that resets the instance to a fresh state while
keeping your own admin login: it removes all other users and their data, all
tasks and history (including the admin's), all settings (OIDC config,
registration toggles, the site default theme), all preferences, and all reminder
state. The confirmation dialog spells out the scope. Use with care - take a
backup first.

## Check for updates

The changelog (opened from the version label) includes an admin-only "Check for
updates" that reports whether a newer version exists, read from
`TASKRR_UPDATE_CHECK_URL`. It is informational only - Taskrr never updates itself.
To update, pull the new image (see [Installation](Installation)).
