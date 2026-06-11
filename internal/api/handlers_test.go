package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/andri1305/taskrr/internal/auth"
	"github.com/andri1305/taskrr/internal/store"
)

// signIn creates a real session for u and returns the cookie a browser would
// send, so tests can exercise the full Handler() (router + withUser).
func signIn(t *testing.T, st *store.Store, ttl time.Duration, u store.User) *http.Cookie {
	t.Helper()
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatalf("NewSessionToken: %v", err)
	}
	if err := st.CreateSession(context.Background(), hash, u.ID, time.Now().Add(ttl)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	return &http.Cookie{Name: sessionCookie, Value: token}
}

// TestQuickLogAcceptsEmptyBody pins the quick-log contract: POSTing to
// /complete with no body at all logs "done right now" — including when the
// request is chunked (ContentLength -1), which the old length check rejected.
func TestQuickLogAcceptsEmptyBody(t *testing.T) {
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

	for _, tc := range []struct {
		name    string
		body    io.Reader
		chunked bool
	}{
		{"no body", nil, false},
		{"chunked empty body", io.NopCloser(strings.NewReader("")), true},
		{"explicit empty object", strings.NewReader("{}"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/tasks/%d/complete", task.ID), tc.body)
			if tc.chunked {
				req.ContentLength = -1
			}
			req.AddCookie(cookie)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusCreated {
				t.Fatalf("complete with %s = %d, want 201 (body: %s)", tc.name, w.Code, w.Body.String())
			}
		})
	}
}

// TestTextLengthCaps verifies the caps on user-supplied text: task names,
// descriptions, and completion notes.
func TestTextLengthCaps(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	task, _ := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "ok"})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	post := func(path, body string) int {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.AddCookie(cookie)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	longName := strings.Repeat("n", maxNameLen+1)
	if code := post("/api/tasks", `{"name":"`+longName+`"}`); code != http.StatusBadRequest {
		t.Fatalf("oversized task name = %d, want 400", code)
	}
	longText := strings.Repeat("d", maxTextLen+1)
	if code := post("/api/tasks", `{"name":"ok","description":"`+longText+`"}`); code != http.StatusBadRequest {
		t.Fatalf("oversized description = %d, want 400", code)
	}
	if code := post(fmt.Sprintf("/api/tasks/%d/complete", task.ID), `{"note":"`+longText+`"}`); code != http.StatusBadRequest {
		t.Fatalf("oversized note = %d, want 400", code)
	}
	// At the cap is fine.
	if code := post(fmt.Sprintf("/api/tasks/%d/complete", task.ID), `{"note":"`+strings.Repeat("n", maxTextLen)+`"}`); code != http.StatusCreated {
		t.Fatalf("note at the cap = %d, want 201", code)
	}
}

// TestUsernameValidation covers the new username policy on registration.
func TestUsernameValidation(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	if err := st.SetSetting(ctx, keyRegLocal, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	s := NewServer(st, Options{})
	h := s.Handler()

	register := func(username string) int {
		body := fmt.Sprintf(`{"username":%q,"password":"longenough"}`, username)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/register", strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	if code := register(strings.Repeat("u", maxUsernameLen+1)); code != http.StatusBadRequest {
		t.Fatalf("oversized username = %d, want 400", code)
	}
	if code := register("with\ncontrol"); code != http.StatusBadRequest {
		t.Fatalf("control-char username = %d, want 400", code)
	}
	if code := register("fine-name"); code != http.StatusCreated {
		t.Fatalf("valid username = %d, want 201", code)
	}
}

// TestSessionRenewalOnPageLoad verifies the sliding session: a top-level page
// load on a session past half its TTL re-issues the cookie with a new expiry,
// while a fresh session is left alone.
func TestSessionRenewalOnPageLoad(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{SessionTTL: 10 * time.Hour})
	h := s.Handler()

	pageLoad := func(c *http.Cookie) *http.Response {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Sec-Fetch-Dest", "document")
		req.AddCookie(c)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Result()
	}
	sessionCookieFrom := func(res *http.Response) *http.Cookie {
		for _, c := range res.Cookies() {
			if c.Name == sessionCookie {
				return c
			}
		}
		return nil
	}

	// A session in its second half (3h left of a 10h TTL) gets renewed.
	aging := signIn(t, st, 3*time.Hour, u)
	reissued := sessionCookieFrom(pageLoad(aging))
	if reissued == nil {
		t.Fatal("an aging session should re-issue the cookie on a page load")
	}
	if reissued.Expires.Before(time.Now().Add(9 * time.Hour)) {
		t.Fatalf("re-issued expiry %v should be ~a full TTL away", reissued.Expires)
	}
	// The stored row was extended too: a renewal guarded at half-TTL is now a no-op.
	renewedAgain, err := st.RenewSession(ctx, auth.HashToken(aging.Value),
		time.Now().Add(10*time.Hour), time.Now().Add(5*time.Hour))
	if err != nil {
		t.Fatalf("RenewSession: %v", err)
	}
	if renewedAgain {
		t.Fatal("the stored expiry should already be past the half-TTL guard")
	}

	// A fresh session is not touched (no Set-Cookie churn on every load).
	fresh := signIn(t, st, 10*time.Hour, u)
	if c := sessionCookieFrom(pageLoad(fresh)); c != nil {
		t.Fatalf("a fresh session should not be re-issued, got expiry %v", c.Expires)
	}
}
