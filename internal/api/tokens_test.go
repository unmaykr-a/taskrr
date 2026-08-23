package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// mintToken creates an API token through the HTTP surface and returns the
// plaintext value, which the API hands back exactly once.
func mintToken(t *testing.T, h http.Handler, cookie *http.Cookie, name string) (string, int64) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/me/tokens",
		strings.NewReader(fmt.Sprintf(`{"name":%q}`, name)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create token: got %d, body %s", rec.Code, rec.Body.String())
	}
	var out struct {
		ID    int64  `json:"id"`
		Token string `json:"token"`
		Name  string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode token: %v", err)
	}
	if out.Token == "" {
		t.Fatal("create token returned an empty token")
	}
	return out.Token, out.ID
}

func bearer(t *testing.T, h http.Handler, method, path, token string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

// TestAPITokenAuthenticatesTaskRoutes covers the feature's whole point: a token
// can drive the task surface with no session cookie in sight.
func TestAPITokenAuthenticatesTaskRoutes(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	task, err := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "water plants"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	token, _ := mintToken(t, h, cookie, "kitchen tablet")

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("list tasks with token: got %d, body %s", rec.Code, rec.Body.String())
	}
	rec := bearer(t, h, http.MethodPost, fmt.Sprintf("/api/tasks/%d/complete", task.ID), token, "")
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("quick log with token: got %d, body %s", rec.Code, rec.Body.String())
	}
	completions, err := st.ListCompletions(ctx, u.ID, task.ID)
	if err != nil || len(completions) != 1 {
		t.Fatalf("expected 1 completion from the token call, got %d (err %v)", len(completions), err)
	}
}

// TestAPITokenCannotReachAdminOrCredentials is the security contract: a leaked
// token must not be able to take over the instance or lock its owner out.
func TestAPITokenCannotReachAdminOrCredentials(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, admin)
	// Deliberately an *admin's* token: even then it must stay inside the scope.
	token, _ := mintToken(t, h, cookie, "automation")

	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/admin/users", ""},
		{http.MethodGet, "/api/admin/settings", ""},
		{http.MethodGet, "/api/admin/backups", ""},
		{http.MethodPost, "/api/admin/backup", ""},
		{http.MethodPost, "/api/me/password", `{"newPassword":"hunter2hunter2"}`},
		{http.MethodPost, "/api/me/username", `{"username":"taken"}`},
		{http.MethodDelete, "/api/me", ""},
		{http.MethodPost, "/api/me/wipe", ""},
		{http.MethodGet, "/api/me/tokens", ""},
		{http.MethodPost, "/api/me/tokens", `{"name":"second"}`},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := bearer(t, h, tc.method, tc.path, token, tc.body)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("expected 403 for token access, got %d (body %s)", rec.Code, rec.Body.String())
			}
		})
	}

	// The same routes must still work with a real session, so the guard is
	// narrowing token access rather than breaking the app.
	req := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin route with a session: got %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestAPITokenScopeIsAnAllowlist pins the default-deny property: a route nobody
// thought about is refused rather than quietly reachable.
func TestAPITokenScopeIsAnAllowlist(t *testing.T) {
	for _, path := range []string{"/api/tasks", "/api/tasks/1/complete", "/api/completions/3", "/api/activity", "/api/me/export"} {
		if !tokenAllowedPath(path) {
			t.Errorf("expected %s to be allowed for tokens", path)
		}
	}
	for _, path := range []string{
		"/api/admin/users", "/api/me/password", "/api/me", "/api/me/preferences",
		"/api/admin/restore-upload", "/api/some/future/route",
	} {
		if tokenAllowedPath(path) {
			t.Errorf("expected %s to be refused for tokens", path)
		}
	}
}

// TestRevokedTokenStopsWorking covers the lifecycle a user actually relies on.
func TestRevokedTokenStopsWorking(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	token, id := mintToken(t, h, cookie, "old laptop")

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("token should work before revocation, got %d", rec.Code)
	}

	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/me/tokens/%d", id), nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("revoke: got %d, body %s", rec.Code, rec.Body.String())
	}

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked token should be unauthorized, got %d", rec.Code)
	}
}

// TestTokensAreScopedToTheirOwner: one account must never see or revoke
// another's tokens.
func TestTokensAreScopedToTheirOwner(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	aliceCookie := signIn(t, st, s.opts.SessionTTL, alice)
	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)

	_, aliceTokenID := mintToken(t, h, aliceCookie, "alice's")

	// Bob's listing must not include Alice's token.
	req := httptest.NewRequest(http.MethodGet, "/api/me/tokens", nil)
	req.AddCookie(bobCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var bobTokens []store.APIToken
	if err := json.Unmarshal(rec.Body.Bytes(), &bobTokens); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(bobTokens) != 0 {
		t.Fatalf("bob should see no tokens, got %d", len(bobTokens))
	}

	// And Bob must not be able to revoke it.
	req = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/me/tokens/%d", aliceTokenID), nil)
	req.AddCookie(bobCookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-account revoke should 404, got %d", rec.Code)
	}
}

// TestAPITokensCanBeDisabledByAdmin covers the instance-wide switch, including
// that existing tokens keep working so flipping it can't break a live
// automation without warning.
func TestAPITokensCanBeDisabledByAdmin(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	token, _ := mintToken(t, h, cookie, "before")

	if err := st.SetSetting(ctx, keyAPITokens, "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/me/tokens", strings.NewReader(`{"name":"after"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("minting while disabled should 403, got %d", rec.Code)
	}

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("an existing token should keep working, got %d", rec.Code)
	}
}

// TestBearerTokenParsing covers the header shapes that show up in the wild.
func TestBearerTokenParsing(t *testing.T) {
	for _, tc := range []struct{ header, want string }{
		{"Bearer abc123", "abc123"},
		{"bearer abc123", "abc123"}, // schemes are case-insensitive
		{"Bearer   abc123  ", "abc123"},
		{"Basic abc123", ""},
		{"Bearer", ""},
		{"Bearer ", ""},
		{"", ""},
	} {
		r := httptest.NewRequest(http.MethodGet, "/api/tasks", nil)
		if tc.header != "" {
			r.Header.Set("Authorization", tc.header)
		}
		if got := bearerToken(r); got != tc.want {
			t.Errorf("bearerToken(%q) = %q, want %q", tc.header, got, tc.want)
		}
	}
}

// TestTokenAllowlistIsNotAPrefixMatch: the allowlist is meant to refuse a route
// added later unless it is opted in. A bare prefix match would break that for
// any path that merely starts with the same letters.
func TestTokenAllowlistIsNotAPrefixMatch(t *testing.T) {
	allowed := []string{
		"/api/tasks", "/api/tasks/1", "/api/tasks/1/complete", "/api/tasks/1/members",
		"/api/completions", "/api/completions/7",
		"/api/health", "/api/auth/me", "/api/activity", "/api/me/export", "/api/me/shares",
	}
	for _, p := range allowed {
		if !tokenAllowedPath(p) {
			t.Errorf("tokenAllowedPath(%q) = false, want true", p)
		}
	}

	refused := []string{
		// The ones a prefix match would have let through.
		"/api/tasks-admin", "/api/tasksettings", "/api/tasks_export",
		"/api/completionsomething", "/api/completions-admin",
		// And the rest of the API, which was never in scope.
		"/api/me/import", "/api/me/password", "/api/admin/users", "/api/admin/settings",
		"/api/folders/Home/share", "/api/me/tokens",
	}
	for _, p := range refused {
		if tokenAllowedPath(p) {
			t.Errorf("tokenAllowedPath(%q) = true, want false", p)
		}
	}
}

// TestRevokeAllTokens covers the panic button: one call kills every token the
// caller owns, and nobody else's.
func TestRevokeAllTokens(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	aliceCookie := signIn(t, st, s.opts.SessionTTL, alice)
	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)

	first, _ := mintToken(t, h, aliceCookie, "kitchen tablet")
	second, _ := mintToken(t, h, aliceCookie, "shell script")
	bobToken, _ := mintToken(t, h, bobCookie, "bob's")

	req := httptest.NewRequest(http.MethodDelete, "/api/me/tokens", nil)
	req.AddCookie(aliceCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke all: got %d, body %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Revoked int64 `json:"revoked"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Revoked != 2 {
		t.Fatalf("revoked count: got %d, want 2", out.Revoked)
	}

	for _, tok := range []string{first, second} {
		if rec := bearer(t, h, http.MethodGet, "/api/tasks", tok, ""); rec.Code != http.StatusUnauthorized {
			t.Fatalf("revoked token still works: got %d", rec.Code)
		}
	}
	if rec := bearer(t, h, http.MethodGet, "/api/tasks", bobToken, ""); rec.Code != http.StatusOK {
		t.Fatalf("another account's token should be untouched, got %d", rec.Code)
	}
}

// TestChangingPasswordRevokesTokens: a password change is what you do when you
// think a credential has leaked, so bearer tokens have to go with the cookies.
func TestChangingPasswordRevokesTokens(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user"})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	token, _ := mintToken(t, h, cookie, "old laptop")

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusOK {
		t.Fatalf("token should work before the password change, got %d", rec.Code)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/me/password",
		strings.NewReader(`{"newPassword":"hunter2hunter2"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("change password: got %d, body %s", rec.Code, rec.Body.String())
	}

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("token should be dead after the password change, got %d", rec.Code)
	}
}

// TestTerminateSessionsRevokesTokens: the admin's "this account looks
// compromised" button has to close the token door too, not just the browser one.
func TestTerminateSessionsRevokesTokens(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	adminCookie := signIn(t, st, s.opts.SessionTTL, admin)
	userCookie := signIn(t, st, s.opts.SessionTTL, u)
	token, _ := mintToken(t, h, userCookie, "kitchen tablet")

	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/admin/sessions/%d", u.ID), nil)
	req.AddCookie(adminCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("terminate: got %d, body %s", rec.Code, rec.Body.String())
	}

	if rec := bearer(t, h, http.MethodGet, "/api/tasks", token, ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("terminated account's token should be dead, got %d", rec.Code)
	}
}
