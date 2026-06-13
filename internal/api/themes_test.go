package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// TestEnforcedDefaultTheme: with enforce on, a non-customized user's GET
// /preferences returns the site default theme; a customized user keeps theirs.
func TestEnforcedDefaultTheme(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	_ = st.SetSetting(ctx, keyDefaultTheme, `{"name":"site","colors":{"accent":"#abcdef"}}`)
	_ = st.SetSetting(ctx, keyDefaultThemeEnforce, "true")
	s := NewServer(st, Options{})

	get := func() map[string]json.RawMessage {
		w := httptest.NewRecorder()
		s.handleGetPreferences(w, authed("GET", "", u))
		var blob map[string]json.RawMessage
		if err := json.Unmarshal(w.Body.Bytes(), &blob); err != nil {
			t.Fatalf("parse prefs: %v (%s)", err, w.Body.String())
		}
		return blob
	}

	// Non-customized: stored theme is "mine", but enforce overrides to the default.
	_ = st.SetUserPreferences(ctx, u.ID, `{"theme":{"name":"mine"},"prefs":{"themeCustom":false}}`)
	if got := string(get()["theme"]); !strings.Contains(got, `"name":"site"`) {
		t.Fatalf("enforce should return the site default theme, got %s", got)
	}

	// Customized: the user's own theme is respected.
	_ = st.SetUserPreferences(ctx, u.ID, `{"theme":{"name":"mine"},"prefs":{"themeCustom":true}}`)
	if got := string(get()["theme"]); !strings.Contains(got, `"name":"mine"`) {
		t.Fatalf("a customized user should keep their theme, got %s", got)
	}

	// Enforce off: even a non-customized user keeps their stored theme.
	_ = st.SetSetting(ctx, keyDefaultThemeEnforce, "false")
	_ = st.SetUserPreferences(ctx, u.ID, `{"theme":{"name":"mine"},"prefs":{"themeCustom":false}}`)
	if got := string(get()["theme"]); !strings.Contains(got, `"name":"mine"`) {
		t.Fatalf("enforce off should keep the stored theme, got %s", got)
	}
}

// TestSharedThemes covers publish/list/unshare and the shareable gate.
func TestSharedThemes(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	user, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})

	// Sharing disabled by default → publish is refused.
	w := httptest.NewRecorder()
	s.handleShareTheme(w, authed("POST", `{"name":"Ocean"}`, admin))
	if w.Code != 403 {
		t.Fatalf("share while disabled = %d, want 403", w.Code)
	}

	// Enable sharing, publish as admin.
	_ = st.SetSetting(ctx, keyThemesShareable, "true")
	w = httptest.NewRecorder()
	s.handleShareTheme(w, authed("POST", `{"name":"Ocean","colors":{"accent":"#005f73"}}`, admin))
	if w.Code != 200 {
		t.Fatalf("share = %d, want 200 (%s)", w.Code, w.Body.String())
	}

	// Any signed-in user can list it.
	w = httptest.NewRecorder()
	s.handleListSharedThemes(w, authed("GET", "", user))
	if !strings.Contains(w.Body.String(), `"Ocean"`) {
		t.Fatalf("user should see the shared theme, got %s", w.Body.String())
	}

	// Re-publishing the same name replaces, not duplicates.
	w = httptest.NewRecorder()
	s.handleShareTheme(w, authed("POST", `{"name":"Ocean","colors":{"accent":"#000000"}}`, admin))
	var list []json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("re-share same name should replace; got %d themes", len(list))
	}

	// A non-admin cannot publish.
	w = httptest.NewRecorder()
	s.handleShareTheme(w, authed("POST", `{"name":"Sneaky"}`, user))
	if w.Code != 403 {
		t.Fatalf("non-admin share = %d, want 403", w.Code)
	}

	// Unshare by name.
	req := authed("DELETE", "", admin)
	req.SetPathValue("name", "Ocean")
	w = httptest.NewRecorder()
	s.handleUnshareTheme(w, req)
	if w.Code != 200 || strings.Contains(w.Body.String(), "Ocean") {
		t.Fatalf("unshare failed: %d %s", w.Code, w.Body.String())
	}
}
