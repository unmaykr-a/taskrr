# Development and Contributing

This page covers building Taskrr from source, the development workflow, and the
conventions to follow when contributing.

## Prerequisites

- **Go 1.25+**
- **Node 22+**

## Build

```bash
git clone https://github.com/unmaykr-a/taskrr.git
cd taskrr
make build      # builds the frontend, then the Go binary -> bin/taskrr
./bin/taskrr    # serves on :8787, data in ./data
```

## Make targets

| Target | What it does |
| --- | --- |
| `make build` | Build the frontend and backend into `bin/taskrr`. |
| `make frontend` | Install deps and build the frontend into the embed dir. |
| `make backend` | Build the Go binary (embeds whatever is in `internal/web/dist`). |
| `make run` | Build everything and run on `:8787`. |
| `make dev-backend` | Run the backend with live logs (no frontend build), `:8787`. |
| `make dev-frontend` | Run the Vite dev server (proxies `/api` to `:8787`). |
| `make test` | Run all tests (Go + frontend). |
| `make test-go` | Run the Go tests. |
| `make test-web` | Run the frontend unit tests. |
| `make vet` | `go vet` plus the frontend TypeScript typecheck. |
| `make install-hooks` | Enable the pre-commit hook that blocks commits on failing checks. |
| `make tidy` | Tidy Go modules. |
| `make docker` | Build the Docker image for the local architecture. |
| `make clean` | Remove build artifacts. |

## Development loop

Run two terminals:

```bash
make dev-backend     # API on :8787
make dev-frontend    # Vite on :5173, proxying /api to :8787
```

The Vite dev server gives instant frontend reloads. The Go backend serves the API
directly. Note that `make dev-backend` (or `go run`) serves whatever is currently
in `internal/web/dist`; to see frontend changes in the **embedded** binary you
must rebuild it (`make frontend` or `make build`).

## Project conventions

- **Timestamps** are RFC 3339 UTC text in the database; the Go layer owns the
  format. JSON is camelCase to match `web/src/lib/api.ts`.
- **Migrations:** add `internal/store/migrations/NNNN_name.sql`. They run in
  filename order and are tracked in `schema_migrations`. Never edit an applied
  migration.
- **Adding an endpoint:** add the route in `internal/api/server.go` (and to the
  relevant store interface if it needs the data layer), the handler in the API
  package, the store method in `internal/store/`, and the client method and type
  in `web/src/lib/api.ts`.
- **Tunable UI policy** (staleness colours/thresholds, filter views) lives in
  `web/src/lib/` and is unit-tested - change it there, not in components.
- **UI primitives** live in `web/src/components/ui/`; feature components sit above
  them.
- **No emojis** anywhere - code, comments, UI strings, docs, commit messages, or
  shell output. Use plain text or a lucide icon.
- **Versioning** is semantic, with a single source of truth in
  `web/package.json`. Bump it in the same change: PATCH for fixes, MINOR for
  features, MAJOR for breaking changes. Add a matching entry to the in-app
  changelog (`web/src/lib/releases.ts`); a test enforces that the top entry
  matches the current version.

## Testing

- `make test` runs the Go suite and the frontend Vitest suite.
- `make vet` runs `go vet` and the TypeScript typecheck.
- `make install-hooks` wires these into a pre-commit gate.

Run the full set before opening a pull request.

## Continuous integration

CI runs Go vet/build/test, the frontend typecheck/test/build, and a multi-arch
(`amd64`, `arm64`) Docker build. Keep changes green.

## Pull requests

Open a pull request against `main`, keep it focused, and make sure CI passes.
Update the in-app changelog and bump the version when your change is user-facing.

## Architecture

See [Architecture](Architecture) for how the backend, frontend, storage, and
store interfaces fit together.
