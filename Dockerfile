# syntax=docker/dockerfile:1

# ---------- Stage 1: build the frontend ----------
# Pinned to the BUILD platform (not the target): the frontend output is just
# JS/CSS, identical for every arch, so there's no reason to build it twice (and
# under QEMU) for a multi-arch image.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app/web
# Install deps first for better layer caching; cache the npm store across builds.
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# Vite writes the build to /app/internal/web/dist (see vite.config.ts outDir).
RUN npm run build

# ---------- Stage 2: build the Go binary ----------
# Also pinned to the BUILD platform so the Go toolchain runs natively and
# CROSS-COMPILES to the target arch via GOARCH — far faster than running the
# whole compile under QEMU emulation (which is what made the arm64 step slow).
# The persistent build/module caches mean unchanged deps (notably the large
# modernc.org/sqlite + libc packages) aren't recompiled on every build.
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
# Bring in the built frontend so go:embed picks it up.
COPY --from=frontend /app/internal/web/dist ./internal/web/dist
# TARGETOS/TARGETARCH are auto-populated by BuildKit from the target platform
# (the host's arch for a plain `docker build`, or each `--platform` for a
# multi-arch buildx build). CGO is off, so this is a pure cross-compile.
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -ldflags="-s -w" -o /taskrr ./cmd/taskrr

# ---------- Stage 3: minimal runtime ----------
FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /data
COPY --from=backend /taskrr /taskrr
ENV TASKRR_ADDR=":8787" \
    TASKRR_DB_PATH="/data/taskrr.db"
EXPOSE 8787
# /data holds the SQLite database. In Compose we bind-mount ./data here; the
# VOLUME keeps `docker run` users from losing data if they forget to mount.
VOLUME ["/data"]
USER nonroot:nonroot
# Distroless has no shell/curl, so the binary self-probes /api/health.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/taskrr", "-health"]
ENTRYPOINT ["/taskrr"]
