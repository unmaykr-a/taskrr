package api

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// API tokens: bearer credentials for automation.
//
// Reminders already go *out* to a webhook; a token closes the loop so something
// else can log a task coming back in — a shell script, an NFC tag by the door,
// a Home Assistant automation.
//
// Two deliberate limits keep a leaked token far less dangerous than a stolen
// session cookie:
//
//   - Tokens reach the task surface only (see tokenAllowedPath). Admin routes,
//     credential changes, and account deletion all require a real session, so a
//     token can never escalate into taking over the instance or locking its
//     owner out.
//   - The token is shown once, at creation, and only its SHA-256 digest is
//     stored — a database or backup leak yields nothing usable.
type tokenCtxKey struct{}

// maxTokenNameLen bounds the user's label for a token.
const maxTokenNameLen = 60

// authedByToken reports whether this request was authenticated with a bearer
// token rather than a session cookie.
func authedByToken(ctx context.Context) bool {
	v, _ := ctx.Value(tokenCtxKey{}).(bool)
	return v
}

// tokenAllowedPath is the allowlist a token-authenticated request must match.
//
// An allowlist rather than a denylist on purpose: a new route added later is
// then refused by default and has to be opted in deliberately, instead of
// silently becoming reachable by every token that already exists.
func tokenAllowedPath(path string) bool {
	switch path {
	case "/api/health", "/api/auth/me", "/api/activity", "/api/me/export", "/api/me/shares":
		return true
	}
	// Tasks and their completions: the whole point of automating this app.
	return strings.HasPrefix(path, "/api/tasks") || strings.HasPrefix(path, "/api/completions")
}

// tokenScope rejects token-authenticated requests aimed outside the allowlist.
// Session-authenticated requests pass straight through.
func tokenScope(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authedByToken(r.Context()) && !tokenAllowedPath(r.URL.Path) {
			writeError(w, http.StatusForbidden,
				"API tokens can only reach tasks and completions; sign in for this")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bearerToken pulls the credential out of an Authorization header.
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// --- handlers ---------------------------------------------------------------

type tokenCreateRequest struct {
	Name string `json:"name"`
}

// tokenCreateResponse carries the one and only sighting of the plaintext token.
type tokenCreateResponse struct {
	store.APIToken
	Token string `json:"token"`
}

func (s *Server) handleListAPITokens(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	tokens, err := s.store.ListAPITokens(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list tokens")
		return
	}
	writeJSON(w, http.StatusOK, tokens)
}

func (s *Server) handleCreateAPIToken(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.apiTokensEnabled(r.Context()) {
		writeError(w, http.StatusForbidden, "API tokens are disabled on this instance")
		return
	}
	var req tokenCreateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "API token"
	}
	if utf8.RuneCountInString(name) > maxTokenNameLen {
		writeError(w, http.StatusBadRequest, "token name is too long")
		return
	}

	token, hash, err := auth.NewSessionToken() // same 256-bit opaque format as sessions
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate token")
		return
	}
	rec, err := s.store.CreateAPIToken(r.Context(), u.ID, name, hash)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save token")
		return
	}
	writeJSON(w, http.StatusCreated, tokenCreateResponse{APIToken: rec, Token: token})
}

func (s *Server) handleDeleteAPIToken(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.DeleteAPIToken(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not revoke token")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// apiTokensEnabled reports the admin's instance-wide switch for the feature.
// On by default: a single-user instance is the common case, and there the owner
// is the admin anyway.
func (s *Server) apiTokensEnabled(ctx context.Context) bool {
	return s.boolSetting(ctx, keyAPITokens, true)
}
