// Package config loads runtime configuration from the environment.
//
// Everything is driven by environment variables so the app composes cleanly
// with Docker Compose: no config files to mount, just a few TASKRR_* vars.
//
// Why env vars (and not a config file)? For a single-binary, self-hosted app
// this is the least-surprising knob: it works identically in a shell, a
// systemd unit, and a Docker Compose `environment:` block, with nothing to
// parse or keep in sync.
package config

import (
	"os"
	"time"
)

// Config holds all runtime settings for the server.
type Config struct {
	// Addr is the TCP address the HTTP server listens on, e.g. ":8787".
	Addr string
	// DBPath is the filesystem path to the SQLite database file. Its parent
	// directory is created automatically on startup (see store.Open).
	DBPath string

	// --- auth (Phase 2) ---

	// AdminUsername is the bootstrap admin account, created on first boot.
	AdminUsername string
	// AdminPassword is the bootstrap admin's plaintext password (hashed on first
	// boot). Ignored if AdminPasswordHash is set.
	AdminPassword string
	// AdminPasswordHash is a pre-computed password hash for the bootstrap admin
	// (wins over AdminPassword, so the secret needn't be plaintext in the env).
	AdminPasswordHash string
	// SessionTTL is how long a login session stays valid.
	SessionTTL time.Duration
	// CookieSecure marks session cookies Secure (HTTPS-only). Enable behind a
	// TLS-terminating reverse proxy.
	CookieSecure bool
	// TrustProxyHeaders controls whether the client IP (used for per-IP login
	// rate limiting and access logs) may be read from CF-Connecting-IP /
	// X-Forwarded-For. Keep it on behind a reverse proxy; turn it OFF when the
	// server is reachable directly, or anyone can spoof those headers to bypass
	// the per-IP limiter.
	TrustProxyHeaders bool
	// SecretKey, when set, encrypts at-rest secrets (the OIDC client secret) so
	// they aren't stored in plaintext in the database or in downloadable backups.
	// The key stays in the environment, never in the DB/backup.
	SecretKey string

	// ReminderInterval is how often the background loop checks for due tasks to
	// send reminder webhooks (Phase 4).
	ReminderInterval time.Duration

	// Lite turns off the multi-user surface (self-registration and creating extra
	// accounts) for a single-person instance. The one bootstrap admin still works.
	Lite bool

	// --- OIDC (Phase 2; initial values, overridable later in the admin UI) ---
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCRedirectURL  string
}

// Load reads configuration from the environment, applying sensible defaults
// that work out of the box for local development and on a Raspberry Pi.
//
// Defaults:
//   - Addr   ":8787"            (an uncommon port, unlikely to clash with
//     other self-hosted services like 8080/3000)
//   - DBPath "./data/taskrr.db" (keeps all state under ./data, which maps
//     cleanly to a `./data:/data` bind mount in Docker)
func Load() Config {
	return Config{
		Addr:   env("TASKRR_ADDR", ":8787"),
		DBPath: env("TASKRR_DB_PATH", "./data/taskrr.db"),

		AdminUsername:     env("TASKRR_ADMIN_USERNAME", "admin"),
		AdminPassword:     env("TASKRR_ADMIN_PASSWORD", ""),
		AdminPasswordHash: env("TASKRR_ADMIN_PASSWORD_HASH", ""),
		SessionTTL:        envDuration("TASKRR_SESSION_TTL", 30*24*time.Hour),
		CookieSecure:      envBool("TASKRR_COOKIE_SECURE", false),
		TrustProxyHeaders: envBool("TASKRR_TRUST_PROXY_HEADERS", true),
		SecretKey:         env("TASKRR_SECRET_KEY", ""),
		ReminderInterval:  envDuration("TASKRR_REMINDER_INTERVAL", time.Minute),
		Lite:              envBool("TASKRR_LITE", false),

		OIDCIssuer:       env("TASKRR_OIDC_ISSUER", ""),
		OIDCClientID:     env("TASKRR_OIDC_CLIENT_ID", ""),
		OIDCClientSecret: env("TASKRR_OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURL:  env("TASKRR_OIDC_REDIRECT_URL", ""),
	}
}

// env returns the value of key, or def if the variable is unset or empty.
func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func envBool(key string, def bool) bool {
	switch env(key, "") {
	case "1", "true", "TRUE", "yes", "on":
		return true
	case "0", "false", "FALSE", "no", "off":
		return false
	default:
		return def
	}
}
