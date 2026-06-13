// Package api wires the HTTP layer: routing, JSON helpers, auth, and serving the
// embedded single-page frontend. It depends only on the store interfaces below,
// keeping transport concerns decoupled from any particular data layer.
package api

import (
	"context"
	"io"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/logbuf"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// TaskStore is the per-user task/completion surface the HTTP layer needs. Every
// method is scoped by ownerID so a request can only ever touch its own data.
type TaskStore interface {
	ListTasks(ctx context.Context, ownerID int64) ([]store.Task, error)
	GetTask(ctx context.Context, ownerID, id int64) (store.Task, error)
	CreateTask(ctx context.Context, ownerID int64, in store.TaskInput) (store.Task, error)
	UpdateTask(ctx context.Context, ownerID, id int64, in store.TaskInput) (store.Task, error)
	SetTaskArchived(ctx context.Context, ownerID, id int64, archived bool) (store.Task, error)
	DeleteTask(ctx context.Context, ownerID, id int64) error

	AddCompletion(ctx context.Context, ownerID, taskID int64, completedAt time.Time, note string) (store.Completion, error)
	ListCompletions(ctx context.Context, ownerID, taskID int64) ([]store.Completion, error)
	UpdateCompletion(ctx context.Context, ownerID, id int64, completedAt time.Time, note string) (store.Completion, error)
	DeleteCompletion(ctx context.Context, ownerID, id int64) error

	ListActivity(ctx context.Context, ownerID int64, from, to time.Time) ([]store.Activity, error)
}

// AuthStore is everything the HTTP layer needs for accounts, sessions, and
// admin-editable settings.
type AuthStore interface {
	CreateUser(ctx context.Context, in store.UserInput) (store.User, error)
	GetUserByID(ctx context.Context, id int64) (store.User, error)
	GetUserByUsername(ctx context.Context, username string) (store.User, error)
	GetUserByOIDCSubject(ctx context.Context, subject string) (store.User, error)
	ListUsers(ctx context.Context) ([]store.User, error)
	CountUsers(ctx context.Context) (int, error)
	CountAdmins(ctx context.Context) (int, error)
	UpdateUserRole(ctx context.Context, id int64, role string) error
	UpdateUsername(ctx context.Context, id int64, username string) error
	SetUserPassword(ctx context.Context, id int64, hash *string) error
	SetUserApproved(ctx context.Context, id int64, approved bool) error
	ListPendingUsers(ctx context.Context) ([]store.User, error)
	LinkOIDCSubject(ctx context.Context, id int64, subject string) error
	UnlinkOIDCSubject(ctx context.Context, id int64) error
	DeleteUser(ctx context.Context, id int64) error
	MergeUsers(ctx context.Context, sourceID, targetID int64, moveData bool, newUsername string) error
	WipeAllTasks(ctx context.Context) error
	WipeEverything(ctx context.Context, keepUserID int64) error
	DeleteTasksByOwner(ctx context.Context, ownerID int64) (int64, error)
	DeleteNonAdminUsers(ctx context.Context) (int64, error)
	Backup(ctx context.Context) (string, error)
	ListBackups() ([]store.BackupInfo, error)
	BackupFilePath(name string) (string, bool)
	DeleteBackup(name string) error
	StageRestoreFromBackup(name string) error
	StageRestoreFromReader(src io.Reader) error

	CreateSession(ctx context.Context, tokenHash string, userID int64, expiresAt time.Time) error
	SessionUser(ctx context.Context, tokenHash string) (store.User, error)
	TouchSession(ctx context.Context, tokenHash string) error
	RenewSession(ctx context.Context, tokenHash string, expiresAt, onlyIfBefore time.Time) (bool, error)
	ListUserSessions(ctx context.Context) ([]store.UserSessionSummary, error)
	DeleteSession(ctx context.Context, tokenHash string) error
	DeleteUserSessions(ctx context.Context, userID int64) error

	GetSetting(ctx context.Context, key string) (string, bool, error)
	SetSetting(ctx context.Context, key, value string) error
	AllSettings(ctx context.Context) (map[string]string, error)

	GetUserPreferences(ctx context.Context, userID int64) (string, error)
	SetUserPreferences(ctx context.Context, userID int64, data string) error

	GetReminderSettings(ctx context.Context, userID int64) (store.ReminderSettings, error)
	SetReminderSettings(ctx context.Context, userID int64, rs store.ReminderSettings) error
}

// Store is the full data surface: tasks + auth. The concrete *store.Store
// satisfies it; tests can supply a fake.
type Store interface {
	TaskStore
	AuthStore
}

// Options carries server-level settings derived from config.
type Options struct {
	SessionTTL   time.Duration
	CookieSecure bool
	// ProtectedUserID is the bootstrap admin's id; other admins can't edit or
	// delete it (0 = no protection).
	ProtectedUserID int64
	// OnRestart, if set, gracefully restarts the process (used after staging a
	// backup restore). The container's restart policy brings it back up.
	OnRestart func()
	// Logs, if set, is the in-memory ring the admin UI tails (server/access logs).
	Logs *logbuf.Buffer
	// Lite disables the multi-user surface (self-registration + creating extra
	// accounts) for a single-person instance.
	Lite bool
	// TrustProxyHeaders allows reading the client IP from CF-Connecting-IP /
	// X-Forwarded-For. Disable when the server is exposed directly, so those
	// headers can't be spoofed to dodge the per-IP rate limiter.
	TrustProxyHeaders bool
	// Secrets encrypts at-rest secrets (the OIDC client secret). A nil/no-op
	// cipher keeps the legacy plaintext behaviour.
	Secrets *auth.SecretCipher
	// SafetyBackupOnRestore takes a backup of the current DB before a restore
	// swaps it out (so a mistaken restore is recoverable). Default on.
	SafetyBackupOnRestore bool
}

// Server holds the dependencies shared by all HTTP handlers.
type Server struct {
	store        Store
	opts         Options
	oidc         *oidcManager
	secrets      *auth.SecretCipher
	loginLimiter *rateLimiter // per-username attempts
	ipLimiter    *rateLimiter // per-source-IP attempts (blunts password-spraying)
	restoring    atomic.Bool  // true while a restore is staged + restart pending
}

// NewServer constructs a Server backed by the given store.
func NewServer(st Store, opts Options) *Server {
	if opts.SessionTTL <= 0 {
		opts.SessionTTL = 30 * 24 * time.Hour
	}
	secrets := opts.Secrets
	if secrets == nil {
		secrets, _ = auth.NewSecretCipher("") // no-op cipher
	}
	return &Server{
		store:   st,
		opts:    opts,
		oidc:    &oidcManager{},
		secrets: secrets,
		// Throttle password attempts per account AND per source IP, so neither a
		// focused account attack nor a password-spray across many usernames runs
		// unbounded.
		loginLimiter: newRateLimiter(10, 5*time.Minute),
		ipLimiter:    newRateLimiter(30, 5*time.Minute),
	}
}

// Handler builds the application's http.Handler: API routes, the auth surface,
// and the embedded SPA fallback. Uses Go 1.22+ method-aware routing.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)

	// Auth (public — these establish or report a session).
	mux.HandleFunc("GET /api/auth/config", s.handleAuthConfig)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/claim", s.handleClaim)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("GET /api/auth/oidc/login", s.handleOIDCLogin)
	mux.HandleFunc("GET /api/auth/oidc/link", s.handleOIDCLink)
	mux.HandleFunc("GET /api/auth/oidc/callback", s.handleOIDCCallback)

	// Account self-service (any authenticated user).
	mux.HandleFunc("POST /api/me/username", s.handleChangeUsername)
	mux.HandleFunc("POST /api/me/password", s.handleChangePassword)
	mux.HandleFunc("DELETE /api/me/oidc", s.handleUnlinkOIDC)
	mux.HandleFunc("GET /api/me/preferences", s.handleGetPreferences)
	mux.HandleFunc("PUT /api/me/preferences", s.handlePutPreferences)
	mux.HandleFunc("GET /api/me/reminders", s.handleGetReminders)
	mux.HandleFunc("PUT /api/me/reminders", s.handlePutReminders)
	mux.HandleFunc("POST /api/me/reminders/test", s.handleTestReminder)
	mux.HandleFunc("POST /api/me/wipe", s.handleWipeMyData)
	mux.HandleFunc("DELETE /api/me", s.handleDeleteAccount)

	// Tasks (each handler enforces an authenticated owner).
	mux.HandleFunc("GET /api/tasks", s.handleListTasks)
	mux.HandleFunc("POST /api/tasks", s.handleCreateTask)
	mux.HandleFunc("GET /api/tasks/{id}", s.handleGetTask)
	mux.HandleFunc("PATCH /api/tasks/{id}", s.handleUpdateTask)
	mux.HandleFunc("POST /api/tasks/{id}/archive", s.handleArchiveTask)
	mux.HandleFunc("POST /api/tasks/{id}/unarchive", s.handleUnarchiveTask)
	mux.HandleFunc("DELETE /api/tasks/{id}", s.handleDeleteTask)

	mux.HandleFunc("POST /api/tasks/{id}/complete", s.handleCompleteTask)
	mux.HandleFunc("GET /api/tasks/{id}/completions", s.handleListCompletions)
	mux.HandleFunc("PATCH /api/completions/{id}", s.handleUpdateCompletion)
	mux.HandleFunc("DELETE /api/completions/{id}", s.handleDeleteCompletion)

	mux.HandleFunc("GET /api/activity", s.handleListActivity)

	// Admin (each handler enforces an admin user).
	mux.HandleFunc("GET /api/admin/users", s.handleListUsers)
	mux.HandleFunc("POST /api/admin/users", s.handleAdminCreateUser)
	mux.HandleFunc("PATCH /api/admin/users/{id}", s.handleAdminUpdateUser)
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.handleAdminDeleteUser)
	mux.HandleFunc("GET /api/admin/pending", s.handleListPending)
	mux.HandleFunc("POST /api/admin/users/{id}/approve", s.handleApproveUser)
	mux.HandleFunc("POST /api/admin/merge", s.handleMergeUsers)
	mux.HandleFunc("GET /api/admin/sessions", s.handleListSessions)
	mux.HandleFunc("DELETE /api/admin/sessions/{id}", s.handleTerminateSessions)
	mux.HandleFunc("GET /api/admin/logs", s.handleListLogs)
	mux.HandleFunc("GET /api/admin/settings", s.handleGetSettings)
	mux.HandleFunc("PUT /api/admin/settings", s.handlePutSettings)
	mux.HandleFunc("PUT /api/admin/default-theme", s.handleSetDefaultTheme)
	mux.HandleFunc("GET /api/themes/shared", s.handleListSharedThemes)
	mux.HandleFunc("POST /api/admin/shared-themes", s.handleShareTheme)
	mux.HandleFunc("DELETE /api/admin/shared-themes/{name}", s.handleUnshareTheme)
	mux.HandleFunc("POST /api/admin/wipe", s.handleAdminWipe)
	mux.HandleFunc("POST /api/admin/backup", s.handleCreateBackup)
	mux.HandleFunc("GET /api/admin/backups", s.handleListBackups)
	mux.HandleFunc("GET /api/admin/backups/{name}", s.handleDownloadBackup)
	mux.HandleFunc("DELETE /api/admin/backups/{name}", s.handleDeleteBackup)
	mux.HandleFunc("POST /api/admin/restore/{name}", s.handleRestoreBackup)
	mux.HandleFunc("POST /api/admin/restore-upload", s.handleRestoreUpload)

	// Anything not matched above is served from the embedded SPA.
	mux.Handle("/", s.staticHandler())

	return s.secureHeaders(logging(s.withUser(mux)))
}

// contentSecurityPolicy is a defense-in-depth CSP tuned to what the SPA actually
// uses: same-origin scripts (the Vite bundle), inline style *attributes* (the app
// sets many style={} props, and CSP can't nonce those), a data: favicon, and
// same-origin XHR. OIDC sign-in is a top-level navigation (not a fetch/iframe),
// so it isn't constrained here.
const contentSecurityPolicy = "default-src 'self'; " +
	"script-src 'self'; " +
	"style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; " +
	"font-src 'self'; " +
	"connect-src 'self'; " +
	"object-src 'none'; " +
	"base-uri 'self'; " +
	"form-action 'self'; " +
	"frame-ancestors 'none'"

// secureHeaders adds low-risk hardening headers to every response. HSTS is sent
// when the connection is served over HTTPS — either directly (CookieSecure), or
// via a trusted TLS-terminating proxy that reports X-Forwarded-Proto: https
// (the common Cloudflare/Caddy/nginx setup, where the app's own socket is plain
// HTTP). Browsers ignore HSTS received over plain HTTP, so this only takes
// effect on the encrypted leg.
func (s *Server) secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Content-Security-Policy", contentSecurityPolicy)
		https := s.opts.CookieSecure ||
			(s.opts.TrustProxyHeaders && r.Header.Get("X-Forwarded-Proto") == "https")
		if https {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

// statusRecorder captures the response status code for access logging.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// logging is a tiny access-log middleware.
func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The admin log tail polls this endpoint; logging it would flood the very
		// buffer being viewed (and push real lines out), so skip it.
		if r.URL.Path == "/api/admin/logs" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond))
	})
}
