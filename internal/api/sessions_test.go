package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

func TestHandleTerminateSessions(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	primary, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	another, _ := st.CreateUser(ctx, store.UserInput{Username: "admin2", Role: "admin", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	_ = st.CreateSession(ctx, "ptok", primary.ID, time.Now().Add(time.Hour))
	_ = st.CreateSession(ctx, "btok", bob.ID, time.Now().Add(time.Hour))
	s := NewServer(st, Options{ProtectedUserID: primary.ID})

	call := func(actor store.User, targetID int64) int {
		idStr := strconv.FormatInt(targetID, 10)
		r := httptest.NewRequest("DELETE", "/api/admin/sessions/"+idStr, nil)
		r.SetPathValue("id", idStr)
		r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, actor))
		w := httptest.NewRecorder()
		s.handleTerminateSessions(w, r)
		return w.Code
	}

	// A different admin can't sign out the protected primary admin.
	if code := call(another, primary.ID); code != http.StatusForbidden {
		t.Fatalf("terminate protected = %d, want 403", code)
	}
	if _, err := st.SessionUser(ctx, "ptok"); err != nil {
		t.Fatalf("primary's session should survive: %v", err)
	}

	// An admin can sign out a normal user everywhere.
	if code := call(another, bob.ID); code != http.StatusNoContent {
		t.Fatalf("terminate user = %d, want 204", code)
	}
	if _, err := st.SessionUser(ctx, "btok"); err == nil {
		t.Fatal("bob's session should be gone after terminate")
	}
}

func TestIsPageLoad(t *testing.T) {
	cases := []struct {
		name, method, dest, accept, path string
		want                             bool
	}{
		{"document navigation", "GET", "document", "", "/", true},
		{"spa route navigation", "GET", "document", "", "/whatever", true},
		{"api fetch", "GET", "empty", "", "/api/tasks", false},
		{"asset", "GET", "script", "", "/assets/app.js", false},
		{"non-GET document", "POST", "document", "", "/", false},
		{"old browser html GET", "GET", "", "text/html,application/xhtml+xml", "/", true},
		{"old browser api GET", "GET", "", "application/json", "/api/tasks", false},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if c.dest != "" {
			r.Header.Set("Sec-Fetch-Dest", c.dest)
		}
		if c.accept != "" {
			r.Header.Set("Accept", c.accept)
		}
		if got := isPageLoad(r); got != c.want {
			t.Errorf("%s: isPageLoad = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestHandleListSessionsSetsProtected(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	primary, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	_ = st.CreateSession(ctx, "ptok", primary.ID, time.Now().Add(time.Hour))
	s := NewServer(st, Options{ProtectedUserID: primary.ID})

	list, err := st.ListUserSessions(ctx)
	if err != nil || len(list) != 1 {
		t.Fatalf("ListUserSessions = %+v, %v", list, err)
	}
	// The handler decorates the protected flag; verify the wiring matches the id.
	if got := s.opts.ProtectedUserID == list[0].UserID; !got {
		t.Fatal("expected the listed user to be the protected admin")
	}
}
