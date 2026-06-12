package api

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// TestOIDCSecretEncryptedAtRest verifies that with TASKRR_SECRET_KEY set, the
// OIDC client secret is stored as ciphertext (so it isn't exposed in a backup),
// while the OIDC machinery still reads back the real plaintext.
func TestOIDCSecretEncryptedAtRest(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	cipher, _ := auth.NewSecretCipher("a-key")
	s := NewServer(st, Options{ProtectedUserID: admin.ID, Secrets: cipher})

	const secret = "super-secret-oidc-value"
	body := `{"oidc_client_secret":"` + secret + `"}`
	req := authed("PUT", body, admin)
	w := httptest.NewRecorder()
	s.handlePutSettings(w, req)
	if w.Code != 200 {
		t.Fatalf("put settings = %d, want 200 (%s)", w.Code, w.Body.String())
	}

	// Stored value is ciphertext, not the plaintext.
	stored, _, _ := st.GetSetting(ctx, keyOIDCClientSecret)
	if stored == secret {
		t.Fatal("client secret is stored in plaintext")
	}
	if !strings.HasPrefix(stored, "enc:v1:") {
		t.Fatalf("stored secret is not encrypted: %q", stored)
	}

	// The OIDC layer decrypts it back to the original.
	if got := s.oidcSettings(ctx).clientSecret; got != secret {
		t.Fatalf("decrypted secret = %q, want %q", got, secret)
	}

	// The settings API never returns the secret, only that it's set.
	getW := httptest.NewRecorder()
	s.handleGetSettings(getW, authed("GET", "", admin))
	if strings.Contains(getW.Body.String(), secret) {
		t.Fatal("settings response leaked the client secret")
	}
	if !strings.Contains(getW.Body.String(), `"oidc_client_secret_set":true`) {
		t.Fatalf("expected oidc_client_secret_set true, got %s", getW.Body.String())
	}
}

// TestOIDCSecretPlaintextWithoutKey confirms the legacy behaviour is unchanged
// when no key is configured (no-op cipher).
func TestOIDCSecretPlaintextWithoutKey(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID}) // no Secrets => no-op

	w := httptest.NewRecorder()
	s.handlePutSettings(w, authed("PUT", `{"oidc_client_secret":"plain-secret"}`, admin))
	if w.Code != 200 {
		t.Fatalf("put settings = %d, want 200", w.Code)
	}
	stored, _, _ := st.GetSetting(ctx, keyOIDCClientSecret)
	if stored != "plain-secret" {
		t.Fatalf("without a key the secret should be stored as-is, got %q", stored)
	}
	if got := s.oidcSettings(ctx).clientSecret; got != "plain-secret" {
		t.Fatalf("read back = %q, want plain-secret", got)
	}
}
