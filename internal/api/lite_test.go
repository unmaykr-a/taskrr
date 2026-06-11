package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andri1305/taskrr/internal/store"
)

func TestLiteModeDisablesMultiUser(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{Lite: true, ProtectedUserID: admin.ID})

	// auth config reports lite and forces registration off.
	cfgReq := httptest.NewRequest("GET", "/api/auth/config", nil)
	cfgW := httptest.NewRecorder()
	s.handleAuthConfig(cfgW, cfgReq)
	var cfg map[string]any
	_ = json.Unmarshal(cfgW.Body.Bytes(), &cfg)
	if cfg["lite"] != true {
		t.Fatalf("auth config lite = %v, want true", cfg["lite"])
	}
	if cfg["localRegistration"] != false {
		t.Fatalf("lite must force localRegistration false, got %v", cfg["localRegistration"])
	}

	// Self-registration is refused.
	regW := httptest.NewRecorder()
	s.handleRegister(regW, httptest.NewRequest("POST", "/api/auth/register", nil))
	if regW.Code != http.StatusForbidden {
		t.Fatalf("register in lite = %d, want 403", regW.Code)
	}

	// An admin can't create extra accounts.
	body := `{"username":"newbie","role":"user"}`
	acReq := httptest.NewRequest("POST", "/api/admin/users", strings.NewReader(body))
	acReq = acReq.WithContext(context.WithValue(acReq.Context(), userCtxKey{}, admin))
	acW := httptest.NewRecorder()
	s.handleAdminCreateUser(acW, acReq)
	if acW.Code != http.StatusForbidden {
		t.Fatalf("admin create user in lite = %d, want 403", acW.Code)
	}
	if n, _ := st.CountUsers(ctx); n != 1 {
		t.Fatalf("no account should have been created, CountUsers = %d", n)
	}
}

// TestLiteModeOffAllowsCreate is a sanity check that the guard is lite-only.
func TestLiteModeOffAllowsCreate(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID}) // Lite: false

	body := `{"username":"newbie","role":"user"}`
	r := httptest.NewRequest("POST", "/api/admin/users", strings.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, admin))
	w := httptest.NewRecorder()
	s.handleAdminCreateUser(w, r)
	if w.Code != http.StatusCreated && w.Code != http.StatusOK {
		t.Fatalf("create user (lite off) = %d, want 2xx", w.Code)
	}
}
