# Backups and Restore

Taskrr stores everything in a single SQLite file under `./data`. That makes
backups simple, and the admin area adds in-app backup and restore on top.

## The simplest backup: copy the folder

Because all state lives in `./data`, copying that folder (while the container is
stopped, or using the in-app backup which is consistent) is a complete backup.
Moving the instance to another host is moving that folder.

## In-app backups (admin)

From the admin area you can:

- **Create a backup** - a snapshot of the database, saved under the backups
  folder in your data directory.
- **List** existing backups.
- **Download** a backup file to keep off-box.
- **Delete** backups you no longer need.

## Restoring

You can restore in two ways:

- **From a listed backup** - one-click restore of a snapshot Taskrr is holding.
- **From an uploaded file** - restore a backup you downloaded earlier (for
  example onto a fresh instance).

A restore is **staged and then applied on restart**: Taskrr swaps the database in
and restarts the process. Under Docker, the container's restart policy brings it
straight back up. While a restore is staged, the instance is briefly busy.

### The safety snapshot

By default (`TASKRR_SAFETY_BACKUP=true`) Taskrr takes an automatic backup of the
current database **right before** applying a restore, so a mistaken restore can be
undone. If you would rather not accumulate a safety copy on every restore, set
`TASKRR_SAFETY_BACKUP=false` (see [Configuration](Configuration)). The restart log
notes when the safety snapshot was skipped.

## Secrets in backups

If you have **not** set `TASKRR_SECRET_KEY`, the OIDC client secret is stored in
plaintext and therefore included in downloadable backups. Set `TASKRR_SECRET_KEY`
to encrypt it at rest so it never appears in a backup. Note that a backup
encrypted with one key cannot be read after the key changes - keep the key stable
and stored safely. See [OIDC Single Sign-On](OIDC-Single-Sign-On).

## A good routine

- Keep `TASKRR_SAFETY_BACKUP=true` so restores are reversible.
- Periodically **download** a backup off the host (or back up the `./data`
  folder externally) so a disk failure does not take your only copy with it.
- Before a risky change (a big import, or the admin **Wipe everything** action),
  take a fresh backup first.
