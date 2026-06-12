package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// enableOIDCOnly configures enough OIDC settings for oidcEnabled() to be true
// and flips the oidc_only switch.
func enableOIDCOnly(t *testing.T, st *store.Store) {
	t.Helper()
	ctx := context.Background()
	for k, v := range map[string]string{
		"oidc_issuer":        "https://idp.example",
		"oidc_client_id":     "taskrr",
		"oidc_client_secret": "s3cret",
		"oidc_only":          "true",
	} {
		if err := st.SetSetting(ctx, k, v); err != nil {
			t.Fatalf("SetSetting(%s): %v", k, err)
		}
	}
}

// TestOIDCOnlyMode pins the SSO-only behaviour: local sign-in is refused for
// everyone except the protected bootstrap admin (the break-glass path), the
// claim and register flows are blocked, and the login page is told about it.
func TestOIDCOnlyMode(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	adminHash, _ := auth.HashPassword("admin-password")
	userHash, _ := auth.HashPassword("user-password")
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "root", Role: "admin", PasswordHash: &adminHash})
	_, _ = st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: &userHash})
	enableOIDCOnly(t, st)
	s := NewServer(st, Options{ProtectedUserID: admin.ID})
	h := s.Handler()

	post := func(path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", path, strings.NewReader(body))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}

	// A normal user with CORRECT credentials is still refused.
	if w := post("/api/auth/login", `{"username":"bob","password":"user-password"}`); w.Code != 403 {
		t.Fatalf("local login in oidc-only = %d, want 403 (%s)", w.Code, w.Body.String())
	}
	// An unknown user gets the same answer (no enumeration through this path).
	if w := post("/api/auth/login", `{"username":"ghost","password":"whatever"}`); w.Code != 403 {
		t.Fatalf("unknown-user login = %d, want 403", w.Code)
	}
	// The protected bootstrap admin keeps the break-glass password path.
	if w := post("/api/auth/login", `{"username":"root","password":"admin-password"}`); w.Code != 200 {
		t.Fatalf("protected admin login = %d, want 200 (%s)", w.Code, w.Body.String())
	}
	// Claim and register are blocked.
	if w := post("/api/auth/claim", `{"username":"bob","password":"longenough"}`); w.Code != 403 {
		t.Fatalf("claim = %d, want 403", w.Code)
	}
	if w := post("/api/auth/register", `{"username":"new","password":"longenough"}`); w.Code != 403 {
		t.Fatalf("register = %d, want 403", w.Code)
	}

	// The login page is told to hide the local form.
	cfgReq := httptest.NewRequest("GET", "/api/auth/config", nil)
	cfgW := httptest.NewRecorder()
	h.ServeHTTP(cfgW, cfgReq)
	body := cfgW.Body.String()
	if !strings.Contains(body, `"oidcOnly":true`) || !strings.Contains(body, `"localRegistration":false`) {
		t.Fatalf("auth config should advertise oidcOnly and force registration off: %s", body)
	}
}

// TestOIDCOnlyInactiveWithoutOIDC: the switch is inert while OIDC isn't
// configured, so it can never lock everyone out.
func TestOIDCOnlyInactiveWithoutOIDC(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	hash, _ := auth.HashPassword("user-password")
	_, _ = st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: &hash})
	_ = st.SetSetting(ctx, "oidc_only", "true") // set, but OIDC unconfigured
	s := NewServer(st, Options{})

	req := httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"bob","password":"user-password"}`))
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("login with oidc_only set but OIDC unconfigured = %d, want 200 (%s)", w.Code, w.Body.String())
	}
}
