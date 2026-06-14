package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/logbuf"
	"github.com/unmaykr-a/taskrr/internal/store"
)

const sessionCookie = "taskrr_session"

// Settings keys (admin-editable).
const (
	keyRegLocal     = "reg_local"     // allow local username/password self-registration
	keyRegOIDC      = "reg_oidc"      // auto-provision a user on first OIDC login
	keyRegApproval  = "reg_approval"  // local sign-ups need admin approval before sign-in
	keyDefaultTheme = "default_theme" // site-wide default theme (JSON), shown signed-out
	// keyDefaultThemeEnforce: when true, users who haven't customized their own
	// theme follow the site default (and update when an admin changes it).
	keyDefaultThemeEnforce = "default_theme_enforce"
	// keyThemesShareable: when true, admins can publish a saved theme to every
	// user (the "Share" button in the theme customizer).
	keyThemesShareable = "themes_shareable"
	// keyThemesShareUsers: when true (and sharing is on), non-admin users may
	// share themes too, not just admins.
	keyThemesShareUsers = "themes_share_users"
	// keySharedThemes: the JSON array of admin-published themes, available to all.
	keySharedThemes = "shared_themes"
)

type userCtxKey struct{}

// withUser reads the session cookie (if any) and attaches the authenticated user
// to the request context. It never rejects — individual handlers decide whether
// a user is required, so the SPA and public auth endpoints stay reachable.
func (s *Server) withUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
			hash := auth.HashToken(c.Value)
			if u, err := s.store.SessionUser(r.Context(), hash); err == nil {
				// Record "last opened the site" — but only on a top-level page load,
				// not on background API polling or sub-resource fetches. Otherwise an
				// idle-but-open tab (which keeps polling tasks/sessions/logs) would
				// look perpetually active. Best-effort + throttled in the store.
				if isPageLoad(r) {
					_ = s.store.TouchSession(r.Context(), hash)
					s.maybeRenewSession(w, r, c.Value, hash)
				}
				r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// maybeRenewSession slides an active session's expiry: once a session is past
// half its TTL, a page load extends it to a full TTL again (and re-issues the
// cookie to match). An abandoned session still dies after one TTL, but a user
// who keeps visiting is never logged out on an arbitrary cliff. Best-effort.
func (s *Server) maybeRenewSession(w http.ResponseWriter, r *http.Request, token, hash string) {
	now := time.Now().UTC()
	renewed, err := s.store.RenewSession(r.Context(), hash, now.Add(s.opts.SessionTTL), now.Add(s.opts.SessionTTL/2))
	if err == nil && renewed {
		s.setSessionCookie(w, token, now.Add(s.opts.SessionTTL))
	}
}

func userFrom(ctx context.Context) (store.User, bool) {
	u, ok := ctx.Value(userCtxKey{}).(store.User)
	return u, ok
}

// isPageLoad reports whether a request is a top-level navigation — the browser
// opening or reloading the site — as opposed to a fetch/XHR or a sub-resource
// (script, style, image). It uses the Fetch Metadata header when the browser
// sends it, with an Accept-based fallback for older browsers that don't.
func isPageLoad(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	if dest := r.Header.Get("Sec-Fetch-Dest"); dest != "" {
		return dest == "document"
	}
	return !strings.HasPrefix(r.URL.Path, "/api/") &&
		strings.Contains(r.Header.Get("Accept"), "text/html")
}

// requireUser returns the authenticated user, or writes 401 and reports false.
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	u, ok := userFrom(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return store.User{}, false
	}
	return u, true
}

// requireAdmin returns the authenticated admin, or writes 401/403.
func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return store.User{}, false
	}
	if u.Role != "admin" {
		writeError(w, http.StatusForbidden, "admin only")
		return store.User{}, false
	}
	return u, true
}

func (s *Server) boolSetting(ctx context.Context, key string, def bool) bool {
	v, ok, err := s.store.GetSetting(ctx, key)
	if err != nil || !ok {
		return def
	}
	return v == "true"
}

func (s *Server) setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.opts.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
	})
}

func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   s.opts.CookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// startSession creates a session for the user and sets the cookie.
func (s *Server) startSession(w http.ResponseWriter, r *http.Request, u store.User) error {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		return err
	}
	expires := time.Now().Add(s.opts.SessionTTL)
	if err := s.store.CreateSession(r.Context(), hash, u.ID, expires); err != nil {
		return err
	}
	s.setSessionCookie(w, token, expires)
	return nil
}

// --- public auth endpoints ---

// authConfig tells the login page what sign-in options to show, plus the
// site-wide default theme to apply while signed out.
func (s *Server) handleAuthConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var defaultTheme any
	if raw, ok, _ := s.store.GetSetting(ctx, keyDefaultTheme); ok && raw != "" {
		defaultTheme = json.RawMessage(raw)
	}
	oidcUp := s.oidcEnabled(ctx)
	oidcOnly := oidcUp && s.boolSetting(ctx, keyOIDCOnly, false)
	writeJSON(w, http.StatusOK, map[string]any{
		// Lite mode and OIDC-only both force self-registration off.
		"localRegistration":   !s.opts.Lite && !oidcOnly && s.boolSetting(ctx, keyRegLocal, false),
		"oidc":                oidcUp,
		"oidcOnly":            oidcOnly,
		"requiresApproval":    s.boolSetting(ctx, keyRegApproval, false),
		"lite":                s.opts.Lite,
		"defaultTheme":        defaultTheme,
		"defaultThemeEnforce": s.boolSetting(ctx, keyDefaultThemeEnforce, false),
		"themesShareable":     s.boolSetting(ctx, keyThemesShareable, false),
		"themesShareUsers":    s.boolSetting(ctx, keyThemesShareUsers, false),
	})
}

// oidcOnlyActive reports whether local sign-in is disabled in favour of SSO.
// Only active while OIDC is actually configured, so flipping the toggle before
// (or after) SSO works can never lock everyone out.
func (s *Server) oidcOnlyActive(ctx context.Context) bool {
	return s.boolSetting(ctx, keyOIDCOnly, false) && s.oidcEnabled(ctx)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	u.Protected = u.ID == s.opts.ProtectedUserID
	writeJSON(w, http.StatusOK, u)
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// maxUsernameLen bounds new usernames — long names only bloat every response
// that carries them (the JSON body cap is the sole limit otherwise).
const maxUsernameLen = 64

// validateUsername applies the policy for user-chosen names: non-empty after
// trimming, bounded length, no control characters. Returns "" when valid.
func validateUsername(name string) string {
	if name == "" {
		return "username is required"
	}
	if utf8.RuneCountInString(name) > maxUsernameLen {
		return fmt.Sprintf("username must be at most %d characters", maxUsernameLen)
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "username contains invalid characters"
		}
	}
	return ""
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if s.restoreInProgress(w) {
		return
	}
	var req credentials
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if !s.authThrottle(w, r, username) {
		return
	}
	u, err := s.store.GetUserByUsername(r.Context(), username)
	// OIDC-only mode: local sign-in is reserved for the protected bootstrap admin
	// (the break-glass path if the provider is down). Everyone else gets the same
	// answer regardless of credentials, so accounts aren't enumerable through it.
	if s.oidcOnlyActive(r.Context()) && !(err == nil && s.opts.ProtectedUserID != 0 && u.ID == s.opts.ProtectedUserID) {
		auth.DummyVerify(req.Password)
		writeError(w, http.StatusForbidden, "local sign-in is disabled — use single sign-on")
		return
	}
	// An account an admin created but no one has set a password for yet (and that
	// isn't OIDC-only) is "unclaimed": tell the client to switch to set-password.
	if err == nil && u.PasswordHash == nil && u.OIDCSubject == nil {
		writeJSON(w, http.StatusOK, map[string]any{"claim": true, "username": u.Username})
		return
	}
	// Constant-time-ish: run a PBKDF2 verify on every failing path (real check, or
	// a decoy when the user/password is absent) so login timing doesn't reveal
	// whether a username exists.
	authed := err == nil && u.PasswordHash != nil && auth.VerifyPassword(*u.PasswordHash, req.Password)
	if !authed {
		if err != nil || u.PasswordHash == nil {
			auth.DummyVerify(req.Password)
		}
		writeError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	if !u.Approved {
		writeError(w, http.StatusForbidden, "your account is awaiting admin approval")
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start session")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

// handleClaim lets the owner of an unclaimed local account (one with no password
// and no linked OIDC identity) set its first password and sign in. This is how
// admin-created accounts are activated. It's deliberately generic about why a
// claim fails so it doesn't confirm which usernames are claimable beyond what
// the login step already reveals.
func (s *Server) handleClaim(w http.ResponseWriter, r *http.Request) {
	if s.restoreInProgress(w) {
		return
	}
	var req credentials
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if !s.authThrottle(w, r, username) {
		return
	}
	if s.oidcOnlyActive(r.Context()) {
		writeError(w, http.StatusForbidden, "local sign-in is disabled — use single sign-on")
		return
	}
	u, err := s.store.GetUserByUsername(r.Context(), username)
	if err != nil || u.PasswordHash != nil || u.OIDCSubject != nil {
		writeError(w, http.StatusConflict, "this account is already set up — sign in instead")
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	if err := s.store.SetUserPassword(r.Context(), u.ID, &hash); err != nil {
		writeStoreError(w, err, "could not set password")
		return
	}
	u, err = s.store.GetUserByID(r.Context(), u.ID)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start session")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		_ = s.store.DeleteSession(r.Context(), auth.HashToken(c.Value))
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if s.restoreInProgress(w) {
		return
	}
	// Lite mode and OIDC-only hard-disable self-registration regardless of the
	// stored setting.
	if s.opts.Lite || s.oidcOnlyActive(r.Context()) || !s.boolSetting(r.Context(), keyRegLocal, false) {
		writeError(w, http.StatusForbidden, "registration is disabled")
		return
	}
	var req credentials
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if msg := validateUsername(username); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if !s.authThrottle(w, r, username) {
		return
	}
	if err := auth.ValidatePassword(req.Password); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	// When approval is required, the account is created unapproved and can't sign
	// in until an admin approves it.
	needsApproval := s.boolSetting(r.Context(), keyRegApproval, false)
	approved := !needsApproval
	u, err := s.store.CreateUser(r.Context(), store.UserInput{
		Username:     username,
		PasswordHash: &hash,
		Role:         "user",
		Approved:     &approved,
	})
	if err != nil {
		writeError(w, http.StatusConflict, "that username is taken")
		return
	}
	if needsApproval {
		writeJSON(w, http.StatusAccepted, map[string]any{"pending": true, "username": u.Username})
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start session")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

// --- account self-service (any authenticated user) ---

type changePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// handleChangePassword lets a signed-in user set a new password. If they already
// have one, the current password must check out. Changing it revokes every other
// session and re-issues this one, so other devices are logged out.
type usernameRequest struct {
	Username string `json:"username"`
}

// handleChangeUsername lets a signed-in user rename their own account.
func (s *Server) handleChangeUsername(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req usernameRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if msg := validateUsername(username); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	// Reject if another account already uses it (case-insensitively).
	if existing, err := s.store.GetUserByUsername(r.Context(), username); err == nil && existing.ID != u.ID {
		writeError(w, http.StatusConflict, "that username is taken")
		return
	}
	if err := s.store.UpdateUsername(r.Context(), u.ID, username); err != nil {
		writeStoreError(w, err, "could not change username")
		return
	}
	updated, err := s.store.GetUserByID(r.Context(), u.ID)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// handleUnlinkOIDC removes the signed-in user's OIDC link. Refused if they have
// no password (it'd be their only way in).
func (s *Server) handleUnlinkOIDC(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if u.PasswordHash == nil {
		writeError(w, http.StatusConflict, "set a password first — otherwise you'd have no way to sign in")
		return
	}
	if err := s.store.UnlinkOIDCSubject(r.Context(), u.ID); err != nil {
		writeStoreError(w, err, "could not unlink")
		return
	}
	updated, err := s.store.GetUserByID(r.Context(), u.ID)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	updated.Protected = updated.ID == s.opts.ProtectedUserID
	writeJSON(w, http.StatusOK, updated)
}

// selfDestructiveRequest confirms an irreversible self-service action by making
// the caller re-type their own username (a deliberate, hard-to-fat-finger gate).
type selfDestructiveRequest struct {
	Confirm string `json:"confirm"`
}

// handleWipeMyData deletes all of the caller's tasks (and their completions),
// keeping the account, preferences, and sign-in intact.
func (s *Server) handleWipeMyData(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req selfDestructiveRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(req.Confirm), u.Username) {
		writeError(w, http.StatusBadRequest, "type your username to confirm")
		return
	}
	n, err := s.store.DeleteTasksByOwner(r.Context(), u.ID)
	if err != nil {
		writeStoreError(w, err, "could not wipe data")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deletedTasks": n})
}

// handleDeleteAccount lets a user delete their own account and everything it
// owns (tasks, completions, sessions, preferences — all by cascade). The
// protected bootstrap admin can't be deleted, and the last remaining admin
// can't delete themselves (that would lock everyone out).
func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if s.opts.ProtectedUserID != 0 && u.ID == s.opts.ProtectedUserID {
		writeError(w, http.StatusForbidden, "the primary admin account can't be deleted")
		return
	}
	var req selfDestructiveRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(req.Confirm), u.Username) {
		writeError(w, http.StatusBadRequest, "type your username to confirm")
		return
	}
	if u.Role == "admin" {
		if n, err := s.store.CountAdmins(r.Context()); err == nil && n <= 1 {
			writeError(w, http.StatusConflict, "you're the only admin — make someone else an admin first")
			return
		}
	}
	if err := s.store.DeleteUser(r.Context(), u.ID); err != nil {
		writeStoreError(w, err, "could not delete account")
		return
	}
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// protectsAgainst reports whether the bootstrap admin (ProtectedUserID) is being
// targeted by a *different* admin — who isn't allowed to edit or delete it.
func (s *Server) protectsAgainst(actingID, targetID int64) bool {
	return s.opts.ProtectedUserID != 0 && targetID == s.opts.ProtectedUserID && actingID != s.opts.ProtectedUserID
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.authThrottle(w, r, u.Username) {
		return
	}
	var req changePasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if u.PasswordHash != nil && !auth.VerifyPassword(*u.PasswordHash, req.CurrentPassword) {
		writeError(w, http.StatusForbidden, "current password is incorrect")
		return
	}
	if err := auth.ValidatePassword(req.NewPassword); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	if err := s.store.SetUserPassword(r.Context(), u.ID, &hash); err != nil {
		writeStoreError(w, err, "could not update password")
		return
	}
	// Revoke all sessions (including this one), then start a fresh session so the
	// current device stays signed in but every other one is logged out.
	_ = s.store.DeleteUserSessions(r.Context(), u.ID)
	if err := s.startSession(w, r, u); err != nil {
		writeError(w, http.StatusInternalServerError, "could not refresh session")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetPreferences returns the user's stored preferences JSON blob (theme,
// layout, etc.), or an empty object if they have none yet.
func (s *Server) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	data, err := s.store.GetUserPreferences(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	if data == "" {
		data = "{}"
	}
	// Force-default theme: when enabled, users who haven't customised their own
	// theme follow the site default. We apply it here (rather than client-side)
	// so the result is correct regardless of load timing. The prefs blob is
	// otherwise opaque to the server; this is the one place we peek inside it.
	data = s.applyEnforcedTheme(r, data)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(data))
}

// applyEnforcedTheme overrides the theme in a preferences blob with the site
// default when default_theme_enforce is on and the user hasn't customised their
// theme (prefs.themeCustom is not true). Returns the blob unchanged on any miss.
func (s *Server) applyEnforcedTheme(r *http.Request, data string) string {
	ctx := r.Context()
	if !s.boolSetting(ctx, keyDefaultThemeEnforce, false) {
		return data
	}
	def, ok, _ := s.store.GetSetting(ctx, keyDefaultTheme)
	if !ok || def == "" {
		return data
	}
	var blob map[string]json.RawMessage
	if err := json.Unmarshal([]byte(data), &blob); err != nil {
		return data
	}
	// Respect a user who has chosen their own theme.
	if inner, ok := blob["prefs"]; ok {
		var p struct {
			ThemeCustom bool `json:"themeCustom"`
		}
		if json.Unmarshal(inner, &p) == nil && p.ThemeCustom {
			return data
		}
	}
	blob["theme"] = json.RawMessage(def)
	if out, err := json.Marshal(blob); err == nil {
		return string(out)
	}
	return data
}

// handlePutPreferences stores the user's preferences JSON blob verbatim (after a
// validity + size check). The shape is owned by the frontend.
func (s *Server) handlePutPreferences(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10)) // 64 KiB cap
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read body")
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "preferences must be valid JSON")
		return
	}
	if err := s.store.SetUserPreferences(r.Context(), u.ID, string(body)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save preferences")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- rate limiting ---

// rateLimiter is a tiny in-memory sliding-window limiter keyed by an arbitrary
// string (we key login/claim attempts by username). It's process-local — fine
// for a single self-hosted instance. A key's window is pruned when it's touched,
// and a full sweep drops idle keys so a spray of unique usernames/IPs can't grow
// the map without bound.
type rateLimiter struct {
	mu        sync.Mutex
	hits      map[string][]time.Time
	max       int
	window    time.Duration
	lastSweep time.Time
}

func newRateLimiter(max int, window time.Duration) *rateLimiter {
	return &rateLimiter{hits: make(map[string][]time.Time), max: max, window: window, lastSweep: time.Now()}
}

// clientIP best-effort extracts the originating client IP. With TrustProxyHeaders
// it honours the common reverse-proxy headers (Cloudflare's CF-Connecting-IP,
// then X-Forwarded-For's left-most entry); otherwise — or when neither is set —
// it uses the socket address, which can't be spoofed.
func (s *Server) clientIP(r *http.Request) string {
	if s.opts.TrustProxyHeaders {
		if v := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); v != "" {
			return v
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				return strings.TrimSpace(v[:i])
			}
			return strings.TrimSpace(v)
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// authThrottle enforces both the per-IP and per-account attempt limits for the
// auth endpoints. It writes a 429 and returns false when either is exceeded.
func (s *Server) authThrottle(w http.ResponseWriter, r *http.Request, accountKey string) bool {
	ipOK := s.ipLimiter.allow("ip:" + s.clientIP(r))
	userOK := s.loginLimiter.allow("acct:" + strings.ToLower(strings.TrimSpace(accountKey)))
	if !ipOK || !userOK {
		writeError(w, http.StatusTooManyRequests, "too many attempts — wait a few minutes and try again")
		return false
	}
	return true
}

// allow records an attempt for key and reports whether it's within the limit.
func (rl *rateLimiter) allow(key string) bool {
	if rl == nil {
		return true
	}
	now := time.Now()
	cutoff := now.Add(-rl.window)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.sweepLocked(now, cutoff)
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.max {
		rl.hits[key] = kept
		return false
	}
	rl.hits[key] = append(kept, now)
	return true
}

// sweepLocked drops keys whose attempts have all aged out. It runs at most once
// per window, so the per-call cost is amortised to ~nothing. Caller holds mu.
func (rl *rateLimiter) sweepLocked(now time.Time, cutoff time.Time) {
	if now.Sub(rl.lastSweep) < rl.window {
		return
	}
	rl.lastSweep = now
	for k, ts := range rl.hits {
		live := false
		for _, t := range ts {
			if t.After(cutoff) {
				live = true
				break
			}
		}
		if !live {
			delete(rl.hits, k)
		}
	}
}

// --- admin endpoints ---

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list users")
		return
	}
	for i := range users {
		users[i].Protected = users[i].ID == s.opts.ProtectedUserID
	}
	writeJSON(w, http.StatusOK, users)
}

type adminUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

// handleListPending returns accounts awaiting approval.
func (s *Server) handleListPending(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	users, err := s.store.ListPendingUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list pending users")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

// handleApproveUser approves a pending account, optionally setting its role.
func (s *Server) handleApproveUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req adminUserRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Role == "admin" || req.Role == "user" {
		if err := s.store.UpdateUserRole(r.Context(), id, req.Role); err != nil {
			writeStoreError(w, err, "could not set role")
			return
		}
	}
	if err := s.store.SetUserApproved(r.Context(), id, true); err != nil {
		writeStoreError(w, err, "could not approve user")
		return
	}
	u, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

type mergeRequest struct {
	SourceID    int64  `json:"sourceId"`
	TargetID    int64  `json:"targetId"`
	MoveData    bool   `json:"moveData"`
	NewUsername string `json:"newUsername"`
}

// handleMergeUsers folds one account into another: optionally moves the source's
// tasks to the target, transfers the source's OIDC link, deletes the source, and
// optionally renames the target. Admin-only, guarding the acting admin and the
// protected bootstrap admin from being merged away.
func (s *Server) handleMergeUsers(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	var req mergeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.SourceID == 0 || req.TargetID == 0 || req.SourceID == req.TargetID {
		writeError(w, http.StatusBadRequest, "pick two different accounts to merge")
		return
	}
	if req.SourceID == admin.ID {
		writeError(w, http.StatusConflict, "you can't merge your own account away")
		return
	}
	if s.opts.ProtectedUserID != 0 && req.SourceID == s.opts.ProtectedUserID {
		writeError(w, http.StatusForbidden, "the primary admin account can't be merged away")
		return
	}
	// A merge grafts the source's OIDC identity onto the target. Allowing the
	// protected primary admin as a *target* would let another admin attach an
	// identity they control to it and then sign in as the primary admin — a
	// privilege-escalation backdoor. Block it (mirrors the source-side guard).
	if s.opts.ProtectedUserID != 0 && req.TargetID == s.opts.ProtectedUserID {
		writeError(w, http.StatusForbidden, "the primary admin account can't be a merge target")
		return
	}
	// Reject a kept-username that belongs to a third account up front (the source's
	// own name frees up when it's deleted), so a rename conflict can't surface a
	// raw database error.
	if nu := strings.TrimSpace(req.NewUsername); nu != "" {
		if existing, err := s.store.GetUserByUsername(r.Context(), nu); err == nil &&
			existing.ID != req.SourceID && existing.ID != req.TargetID {
			writeError(w, http.StatusConflict, "that username is taken")
			return
		}
	}
	if err := s.store.MergeUsers(r.Context(), req.SourceID, req.TargetID, req.MoveData, strings.TrimSpace(req.NewUsername)); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "account not found")
			return
		}
		writeError(w, http.StatusConflict, "could not merge accounts")
		return
	}
	u, err := s.store.GetUserByID(r.Context(), req.TargetID)
	if err != nil {
		writeStoreError(w, err, "could not load merged account")
		return
	}
	u.Protected = u.ID == s.opts.ProtectedUserID
	writeJSON(w, http.StatusOK, u)
}

// handleListSessions returns, per user with a live session, their session count
// and last-online time — the admin "who's signed in" view.
func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	list, err := s.store.ListUserSessions(r.Context())
	if err != nil {
		writeStoreError(w, err, "could not list sessions")
		return
	}
	for i := range list {
		list[i].Protected = s.opts.ProtectedUserID != 0 && list[i].UserID == s.opts.ProtectedUserID
	}
	writeJSON(w, http.StatusOK, list)
}

// handleTerminateSessions signs a user out everywhere by deleting all their
// sessions. A different admin can't terminate the protected bootstrap admin.
func (s *Server) handleTerminateSessions(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if s.protectsAgainst(admin.ID, id) {
		writeError(w, http.StatusForbidden, "the primary admin can't be signed out by another admin")
		return
	}
	if err := s.store.DeleteUserSessions(r.Context(), id); err != nil {
		writeStoreError(w, err, "could not terminate sessions")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListLogs returns recent server/access log lines from the in-memory ring.
// Pass ?after=<seq> to fetch only lines newer than the last one you saw.
func (s *Server) handleListLogs(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var after int64
	if v := r.URL.Query().Get("after"); v != "" {
		after, _ = strconv.ParseInt(v, 10, 64)
	}
	entries := []logbuf.Entry{}
	if s.opts.Logs != nil {
		entries = s.opts.Logs.Since(after)
	}
	writeJSON(w, http.StatusOK, entries)
}

// handleSetDefaultTheme stores the site-wide default theme (an opaque JSON blob
// owned by the frontend), applied on the signed-out screen and to new users.
func (s *Server) handleSetDefaultTheme(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read body")
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "theme must be valid JSON")
		return
	}
	if err := s.store.SetSetting(r.Context(), keyDefaultTheme, string(body)); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save default theme")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAdminCreateUser(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	if s.opts.Lite {
		writeError(w, http.StatusForbidden, "adding accounts is disabled in lite mode")
		return
	}
	var req adminUserRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	if msg := validateUsername(username); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	role := req.Role
	if role != "admin" {
		role = "user"
	}
	in := store.UserInput{Username: username, Role: role}
	if req.Password != "" {
		if err := auth.ValidatePassword(req.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not hash password")
			return
		}
		in.PasswordHash = &hash
	}
	u, err := s.store.CreateUser(r.Context(), in)
	if err != nil {
		writeError(w, http.StatusConflict, "that username is taken")
		return
	}
	writeJSON(w, http.StatusCreated, u)
}

func (s *Server) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if s.protectsAgainst(admin.ID, id) {
		writeError(w, http.StatusForbidden, "the primary admin account can't be changed by other admins")
		return
	}
	var req adminUserRequest
	if !decodeJSON(w, r, &req) {
		return
	}

	// Update role (guarding against removing the last admin).
	if req.Role == "admin" || req.Role == "user" {
		if req.Role == "user" {
			if err := s.guardLastAdmin(r, id); err != nil {
				writeError(w, http.StatusConflict, err.Error())
				return
			}
		}
		if err := s.store.UpdateUserRole(r.Context(), id, req.Role); err != nil {
			writeStoreError(w, err, "could not update user")
			return
		}
	}

	// Optionally set a new password.
	if req.Password != "" {
		if err := auth.ValidatePassword(req.Password); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not hash password")
			return
		}
		if err := s.store.SetUserPassword(r.Context(), id, &hash); err != nil {
			writeStoreError(w, err, "could not update password")
			return
		}
		// Changing a password logs that user's other sessions out.
		if id != admin.ID {
			_ = s.store.DeleteUserSessions(r.Context(), id)
		}
	}

	u, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if id == admin.ID {
		writeError(w, http.StatusConflict, "you can't delete your own account")
		return
	}
	if s.protectsAgainst(admin.ID, id) {
		writeError(w, http.StatusForbidden, "the primary admin account can't be deleted by other admins")
		return
	}
	if err := s.guardLastAdmin(r, id); err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		writeStoreError(w, err, "could not delete user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// wipeRequest selects what to destroy. `confirm` must equal "WIPE" so an
// accidental/forged request can't trigger it.
type wipeRequest struct {
	Tasks bool `json:"tasks"` // delete all tasks + completions (all users)
	Users bool `json:"users"` // delete all non-admin users + their data
	// Everything resets the whole instance: every other account, all tasks,
	// all settings (OIDC, registration, default theme), preferences and
	// reminders — keeping only the acting admin's username and password.
	Everything bool   `json:"everything"`
	Confirm    string `json:"confirm"` // must be "WIPE"
}

// handleAdminWipe performs destructive, instance-wide deletions. Admin-only and
// gated on an explicit confirmation string.
func (s *Server) handleAdminWipe(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	var req wipeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Confirm != "WIPE" {
		writeError(w, http.StatusBadRequest, `confirmation required (send "confirm":"WIPE")`)
		return
	}
	ctx := r.Context()
	if req.Everything {
		if err := s.store.WipeEverything(ctx, admin.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "could not wipe the instance")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "everything": true})
		return
	}
	var deletedUsers int64
	if req.Users {
		n, err := s.store.DeleteNonAdminUsers(ctx)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not delete users")
			return
		}
		deletedUsers = n
	}
	if req.Tasks {
		if err := s.store.WipeAllTasks(ctx); err != nil {
			writeError(w, http.StatusInternalServerError, "could not wipe tasks")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deletedUsers": deletedUsers})
}

// handleCreateBackup writes a full DB snapshot into data/backups.
func (s *Server) handleCreateBackup(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	name, err := s.store.Backup(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create backup")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"name": name})
}

func (s *Server) handleListBackups(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	list, err := s.store.ListBackups()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list backups")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleDownloadBackup streams a backup file to the browser as a download.
func (s *Server) handleDownloadBackup(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	path, ok := s.store.BackupFilePath(r.PathValue("name"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid backup name")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+r.PathValue("name")+`"`)
	w.Header().Set("Content-Type", "application/octet-stream")
	http.ServeFile(w, r, path)
}

// handleDeleteBackup removes a backup file.
func (s *Server) handleDeleteBackup(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	name := r.PathValue("name")
	if _, ok := s.store.BackupFilePath(name); !ok {
		writeError(w, http.StatusBadRequest, "invalid backup name")
		return
	}
	if err := s.store.DeleteBackup(name); err != nil {
		writeStoreError(w, err, "could not delete backup")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleRestoreBackup restores the database from an existing backup, then
// restarts. See doRestore for the (crash-safe) mechanism.
func (s *Server) handleRestoreBackup(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	name := r.PathValue("name")
	if _, ok := s.store.BackupFilePath(name); !ok {
		writeError(w, http.StatusBadRequest, "invalid backup name")
		return
	}
	s.doRestore(w, r, func() error { return s.store.StageRestoreFromBackup(name) })
}

// handleRestoreUpload restores the database from an uploaded .db file.
func (s *Server) handleRestoreUpload(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 256<<20) // 256 MiB cap
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected a multipart 'file' field")
		return
	}
	defer file.Close()
	s.doRestore(w, r, func() error { return s.store.StageRestoreFromReader(file) })
}

// doRestore takes a safety backup of the current database, stages the chosen
// source for restore, blocks new logins, then triggers a graceful restart. The
// actual file swap happens on the next startup (applyPendingRestore), which is
// the only safe moment to replace an open SQLite file.
func (s *Server) doRestore(w http.ResponseWriter, r *http.Request, stage func() error) {
	// Take a safety snapshot of the current DB first, unless disabled
	// (TASKRR_SAFETY_BACKUP=false), so a mistaken restore can be undone.
	var safety string
	if s.opts.SafetyBackupOnRestore {
		var err error
		safety, err = s.store.Backup(r.Context())
		if err != nil {
			log.Printf("restore: safety backup failed: %v", err)
			writeError(w, http.StatusInternalServerError, "could not take a safety backup before restoring")
			return
		}
	}
	if err := stage(); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "no such backup")
		} else {
			writeError(w, http.StatusBadRequest, err.Error())
		}
		return
	}
	s.restoring.Store(true) // block new logins during the brief pre-restart window
	if safety != "" {
		log.Printf("restore: staged; restarting (safety backup: %s)", safety)
	} else {
		log.Printf("restore: staged; restarting (no safety backup — TASKRR_SAFETY_BACKUP is off)")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "restarting": true, "safetyBackup": safety})

	if s.opts.OnRestart != nil {
		go func() {
			time.Sleep(300 * time.Millisecond) // let the response flush
			s.opts.OnRestart()
		}()
	}
}

// restoreInProgress writes a 503 and returns true while a restore is staged, so
// no new sessions start in the brief window before the restart.
func (s *Server) restoreInProgress(w http.ResponseWriter) bool {
	if s.restoring.Load() {
		writeError(w, http.StatusServiceUnavailable, "the server is restoring a backup — try again in a moment")
		return true
	}
	return false
}

// guardLastAdmin returns an error if demoting/deleting user `id` would leave the
// instance with no admins.
func (s *Server) guardLastAdmin(r *http.Request, id int64) error {
	target, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		return nil // let the caller's own lookup surface a 404
	}
	if target.Role != "admin" {
		return nil
	}
	n, err := s.store.CountAdmins(r.Context())
	if err == nil && n <= 1 {
		return errLastAdmin
	}
	return nil
}

var errLastAdmin = &lastAdminError{}

type lastAdminError struct{}

func (*lastAdminError) Error() string { return "can't remove the last admin" }

// --- settings ---

func (s *Server) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	ctx := r.Context()
	get := func(k string) string { v, _, _ := s.store.GetSetting(ctx, k); return v }
	writeJSON(w, http.StatusOK, map[string]any{
		keyRegLocal:              s.boolSetting(ctx, keyRegLocal, false),
		keyRegOIDC:               s.boolSetting(ctx, keyRegOIDC, true),
		keyRegApproval:           s.boolSetting(ctx, keyRegApproval, false),
		keyOIDCIssuer:            get(keyOIDCIssuer),
		keyOIDCClientID:          get(keyOIDCClientID),
		keyOIDCRedirectURL:       get(keyOIDCRedirectURL),
		keyOIDCAdminGroup:        get(keyOIDCAdminGroup),
		keyOIDCLinkUsername:      s.boolSetting(ctx, keyOIDCLinkUsername, false),
		keyOIDCOnly:              s.boolSetting(ctx, keyOIDCOnly, false),
		keyDefaultThemeEnforce:   s.boolSetting(ctx, keyDefaultThemeEnforce, false),
		keyThemesShareable:       s.boolSetting(ctx, keyThemesShareable, false),
		keyThemesShareUsers:      s.boolSetting(ctx, keyThemesShareUsers, false),
		"oidc_client_secret_set": get(keyOIDCClientSecret) != "", // never return the secret
		"oidc_enabled":           s.oidcEnabled(ctx),
	})
}

// settingsPatch is a partial update; only non-nil fields are written. The client
// secret is only changed when a non-empty value is supplied.
type settingsPatch struct {
	RegLocal            *bool   `json:"reg_local"`
	RegOIDC             *bool   `json:"reg_oidc"`
	RegApproval         *bool   `json:"reg_approval"`
	OIDCIssuer          *string `json:"oidc_issuer"`
	OIDCClientID        *string `json:"oidc_client_id"`
	OIDCClientSecret    *string `json:"oidc_client_secret"`
	OIDCRedirectURL     *string `json:"oidc_redirect_url"`
	OIDCAdminGroup      *string `json:"oidc_admin_group"`
	OIDCLinkUsername    *bool   `json:"oidc_link_username"`
	OIDCOnly            *bool   `json:"oidc_only"`
	DefaultThemeEnforce *bool   `json:"default_theme_enforce"`
	ThemesShareable     *bool   `json:"themes_shareable"`
	ThemesShareUsers    *bool   `json:"themes_share_users"`
}

func (s *Server) handlePutSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	var req settingsPatch
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx := r.Context()
	set := func(k, v string) bool {
		if err := s.store.SetSetting(ctx, k, v); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save settings")
			return false
		}
		return true
	}
	boolStr := func(b bool) string {
		if b {
			return "true"
		}
		return "false"
	}
	if req.RegLocal != nil && !set(keyRegLocal, boolStr(*req.RegLocal)) {
		return
	}
	if req.RegOIDC != nil && !set(keyRegOIDC, boolStr(*req.RegOIDC)) {
		return
	}
	if req.RegApproval != nil && !set(keyRegApproval, boolStr(*req.RegApproval)) {
		return
	}
	if req.OIDCIssuer != nil && !set(keyOIDCIssuer, strings.TrimSpace(*req.OIDCIssuer)) {
		return
	}
	if req.OIDCClientID != nil && !set(keyOIDCClientID, strings.TrimSpace(*req.OIDCClientID)) {
		return
	}
	if req.OIDCRedirectURL != nil && !set(keyOIDCRedirectURL, strings.TrimSpace(*req.OIDCRedirectURL)) {
		return
	}
	if req.OIDCAdminGroup != nil && !set(keyOIDCAdminGroup, strings.TrimSpace(*req.OIDCAdminGroup)) {
		return
	}
	if req.OIDCLinkUsername != nil && !set(keyOIDCLinkUsername, boolStr(*req.OIDCLinkUsername)) {
		return
	}
	if req.OIDCOnly != nil && !set(keyOIDCOnly, boolStr(*req.OIDCOnly)) {
		return
	}
	if req.DefaultThemeEnforce != nil && !set(keyDefaultThemeEnforce, boolStr(*req.DefaultThemeEnforce)) {
		return
	}
	if req.ThemesShareable != nil && !set(keyThemesShareable, boolStr(*req.ThemesShareable)) {
		return
	}
	if req.ThemesShareUsers != nil && !set(keyThemesShareUsers, boolStr(*req.ThemesShareUsers)) {
		return
	}
	// Only overwrite the secret when a new, non-empty one is provided. Encrypt it
	// at rest when TASKRR_SECRET_KEY is set (a no-op otherwise), so it isn't
	// stored — or backed up — in plaintext.
	if req.OIDCClientSecret != nil && strings.TrimSpace(*req.OIDCClientSecret) != "" {
		enc, err := s.secrets.Encrypt(strings.TrimSpace(*req.OIDCClientSecret))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not encrypt the client secret")
			return
		}
		if !set(keyOIDCClientSecret, enc) {
			return
		}
	}
	s.handleGetSettings(w, r)
}
