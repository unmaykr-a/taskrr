package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

func TestVersionLatestIsAdminOnly(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	user, _ := st.CreateUser(ctx, store.UserInput{Username: "user", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{}) // UpdateCheckURL empty -> no network, returns latest ""
	h := s.Handler()

	get := func(u store.User) int {
		req := httptest.NewRequest(http.MethodGet, "/api/version/latest", nil)
		req.AddCookie(signIn(t, st, s.opts.SessionTTL, u))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w.Code
	}

	if code := get(user); code != http.StatusForbidden {
		t.Fatalf("non-admin /api/version/latest = %d, want 403", code)
	}
	if code := get(admin); code != http.StatusOK {
		t.Fatalf("admin /api/version/latest = %d, want 200", code)
	}
}
