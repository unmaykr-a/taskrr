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

// TestInterfaceSettingsAreValidated: the instance's style and layout end up as
// a class name and a layout decision on a page served to signed-out visitors,
// so an unknown value is dropped rather than stored and handed out.
func TestInterfaceSettingsAreValidated(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID, Experimental: true})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, admin)

	put := func(t *testing.T, body string) map[string]any {
		t.Helper()
		req := httptest.NewRequest("PUT", "/api/admin/settings", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 200 {
			t.Fatalf("put settings = %d, body %s", rec.Code, rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return out
	}

	out := put(t, `{"interface_style":"flat","interface_layout":"rail"}`)
	if out[keyInterfaceStyle] != "flat" || out[keyInterfaceLayout] != "rail" {
		t.Fatalf("stored style/layout = %v/%v", out[keyInterfaceStyle], out[keyInterfaceLayout])
	}

	// And they reach the signed-out config, which is the only way the login
	// page could know what the instance looks like.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/config", nil))
	var cfg struct {
		Branding struct {
			Style  string `json:"style"`
			Layout string `json:"layout"`
		} `json:"branding"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if cfg.Branding.Style != "flat" || cfg.Branding.Layout != "rail" {
		t.Fatalf("auth config style/layout = %q/%q", cfg.Branding.Style, cfg.Branding.Layout)
	}

	out = put(t, `{"interface_style":"neon","interface_layout":"carousel"}`)
	if out[keyInterfaceStyle] != "" || out[keyInterfaceLayout] != "" {
		t.Fatalf("unknown values were stored: %v/%v", out[keyInterfaceStyle], out[keyInterfaceLayout])
	}
}
