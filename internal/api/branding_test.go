package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// TestBrandingDefaultsAndSave: authConfig reports branding defaults, a save
// round-trips, and the icon is validated.
func TestBranding(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})
	h := s.Handler()

	// Defaults via authConfig (public).
	cfgW := httptest.NewRecorder()
	h.ServeHTTP(cfgW, httptest.NewRequest("GET", "/api/auth/config", nil))
	if !strings.Contains(cfgW.Body.String(), `"name":"Taskrr"`) ||
		!strings.Contains(cfgW.Body.String(), `"tagline":"last-done tracker"`) {
		t.Fatalf("branding defaults missing: %s", cfgW.Body.String())
	}

	put := func(body string) int {
		req := authed("PUT", body, admin)
		w := httptest.NewRecorder()
		s.handlePutSettings(w, req)
		return w.Code
	}

	// A valid save round-trips into authConfig.
	if code := put(`{"brand_name":"Choreroo","brand_tagline":"chores, sorted","brand_icon":"data:image/png;base64,AAAA"}`); code != 200 {
		t.Fatalf("save branding = %d, want 200", code)
	}
	cfgW = httptest.NewRecorder()
	h.ServeHTTP(cfgW, httptest.NewRequest("GET", "/api/auth/config", nil))
	if !strings.Contains(cfgW.Body.String(), `"name":"Choreroo"`) {
		t.Fatalf("brand name not applied: %s", cfgW.Body.String())
	}

	// A non-image icon is rejected.
	if code := put(`{"brand_icon":"javascript:alert(1)"}`); code != 400 {
		t.Fatalf("non-image icon = %d, want 400", code)
	}
	// An oversized icon is rejected.
	if code := put(`{"brand_icon":"data:image/png;base64,` + strings.Repeat("A", 300<<10) + `"}`); code != 400 {
		t.Fatalf("oversized icon = %d, want 400", code)
	}
}
