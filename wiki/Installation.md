# Installation

Taskrr ships as a single container image with the web UI and a pure-Go SQLite
database built in. The recommended way to run it is Docker Compose.

## Requirements

- Docker with the Compose plugin (`docker compose`).
- A directory for the database (`./data`), bind-mounted into the container.
- Roughly 12 MB of RAM at idle. It runs on `amd64` and `arm64` (Raspberry Pi).

## Quick start (Docker Compose)

No cloning and no building - just the compose file:

```bash
mkdir taskrr && cd taskrr
curl -LO https://raw.githubusercontent.com/unmaykr-a/taskrr/main/docker-compose.yml
mkdir data
docker compose up -d
```

Open <http://localhost:8787> and sign in as `admin`.

If you did not preset a password, the first start prints a one-time setup link:

```bash
docker compose logs taskrr | grep invite
```

Open that link (swapping in your own address if you are not on the same
machine) to choose the admin password. It lasts seven days, and a fresh one is
printed each time the server starts while the account still has no password.
Preset `TASKRR_ADMIN_PASSWORD` to skip the step entirely - see
[Configuration](Configuration).

Your data lives in the plain `./data` folder next to the compose file. Backing up
or moving the instance is just copying that folder.

### File ownership

The container writes as uid/gid `1000` by default (a typical single-user Linux
box). If `id -u` reports something else, set `TASKRR_UID` / `TASKRR_GID` in your
environment (or `.env`) so the files in `./data` are owned by you.

## Configuration file

To preset the admin password or change anything else up front, drop a `.env`
file next to the compose file. The repository's
[`.env.example`](https://github.com/unmaykr-a/taskrr/blob/main/.env.example)
documents every option with working examples, and
[Configuration](Configuration) explains each one.

## The container image

Images are published to GitHub Container Registry:

- `ghcr.io/unmaykr-a/taskrr:latest` - the latest release.
- `ghcr.io/unmaykr-a/taskrr:<version>` - a specific version (for example
  `:1.13.0`), so you can pin or roll back. Versioned tags exist from 1.5.0
  onward.

The image is multi-arch (`amd64`, `arm64`); Docker pulls the right one for your
host automatically.

## Running the binary directly

Every release has prebuilt binaries on the
[releases page](https://github.com/unmaykr-a/taskrr/releases) for Linux
(`amd64`, `arm64`, `armv7`), macOS (Intel and Apple silicon) and Windows. Each
one is the whole application - web UI included - with nothing to install
alongside it:

```bash
curl -LO https://github.com/unmaykr-a/taskrr/releases/latest/download/checksums.txt
curl -LO https://github.com/unmaykr-a/taskrr/releases/latest/download/taskrr_<version>_linux_amd64
sha256sum --check --ignore-missing checksums.txt
chmod +x taskrr_*_linux_amd64
./taskrr_*_linux_amd64      # serves on :8787, data in ./data
```

Or build from source (Go 1.25+ and Node 22+):

```bash
git clone https://github.com/unmaykr-a/taskrr.git
cd taskrr
make build      # builds the frontend and backend -> bin/taskrr
./bin/taskrr    # serves on :8787, data in ./data
```

See [Development and Contributing](Development-and-Contributing) for the full
build and test workflow.

## Updating

With Compose:

```bash
docker compose pull
docker compose up -d
```

Running a binary directly, replace it with the one from the newer release and
restart. The database is untouched by an upgrade.

Schema migrations run automatically on start, in order, and are tracked so they
only ever run once. There is no in-app auto-update; the admin changelog has an
optional, informational "Check for updates" that only reports whether a newer
version exists (see [Configuration](Configuration) and the
[Admin Guide](Admin-Guide)).

## Next steps

- [Configuration](Configuration) - every environment variable.
- [Reverse Proxy and HTTPS](Reverse-Proxy-and-HTTPS) - exposing it safely.
- [Backups and Restore](Backups-and-Restore) - protecting your data.
