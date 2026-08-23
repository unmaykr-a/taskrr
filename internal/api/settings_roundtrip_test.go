package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// TestEverySettingIsReadableBack guards against a setting that can be written
// but never read: the admin form hydrates from GET /api/admin/settings, so a key
// missing there silently resets its control to a default every time the panel
// opens, while the stored value stays whatever it was.
//
// Walking settingsPatch rather than listing keys by hand means a new setting is
// covered the moment it exists.
func TestEverySettingIsReadableBack(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})

	w := httptest.NewRecorder()
	s.handleGetSettings(w, authed("GET", "", admin))
	if w.Code != 200 {
		t.Fatalf("get settings = %d, want 200", w.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("settings body: %v", err)
	}

	patch := reflect.TypeOf(settingsPatch{})
	for i := 0; i < patch.NumField(); i++ {
		tag := strings.Split(patch.Field(i).Tag.Get("json"), ",")[0]
		if tag == "" || tag == "-" {
			continue
		}
		// The client secret is deliberately never echoed; the response reports
		// only whether one is set.
		if tag == "oidc_client_secret" {
			if _, ok := got["oidc_client_secret_set"]; !ok {
				t.Errorf("no oidc_client_secret_set flag in the settings response")
			}
			continue
		}
		if _, ok := got[tag]; !ok {
			t.Errorf("settings key %q can be written but is not returned by GET /api/admin/settings", tag)
		}
	}
}

// TestLoginLayoutRoundTrip: the value the admin picks is the value the form
// reads back, and an unknown one is refused rather than stored.
func TestLoginLayoutRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})

	layout := func() string {
		w := httptest.NewRecorder()
		s.handleGetSettings(w, authed("GET", "", admin))
		var got map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		v, _ := got["login_layout"].(string)
		return v
	}
	put := func(body string) int {
		w := httptest.NewRecorder()
		s.handlePutSettings(w, authed("PUT", body, admin))
		return w.Code
	}

	if got := layout(); got != "centered" {
		t.Fatalf("default layout = %q, want centered", got)
	}
	for _, want := range []string{"left", "right", "centered"} {
		if code := put(`{"login_layout":"` + want + `"}`); code != 200 {
			t.Fatalf("set %s = %d, want 200", want, code)
		}
		if got := layout(); got != want {
			t.Fatalf("after setting %q, read back %q", want, got)
		}
	}

	// Anything else falls back rather than being stored.
	if code := put(`{"login_layout":"sideways"}`); code != 200 {
		t.Fatalf("set nonsense = %d, want 200", code)
	}
	if got := layout(); got != "centered" {
		t.Fatalf("unknown layout stored as %q, want centered", got)
	}

	// And the public config agrees, since that's what the login page reads.
	h := s.Handler()
	_ = put(`{"login_layout":"left"}`)
	cw := httptest.NewRecorder()
	h.ServeHTTP(cw, httptest.NewRequest("GET", "/api/auth/config", nil))
	if !strings.Contains(cw.Body.String(), `"loginLayout":"left"`) {
		t.Fatalf("auth config missing the layout: %s", cw.Body.String())
	}
}
