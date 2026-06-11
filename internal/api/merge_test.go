package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// mergeCall invokes the merge handler as the given admin and returns the recorder.
func mergeCall(t *testing.T, s *Server, actor store.User, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", "/api/admin/merge", bytes.NewReader(b))
	r = r.WithContext(context.WithValue(r.Context(), userCtxKey{}, actor))
	w := httptest.NewRecorder()
	s.handleMergeUsers(w, r)
	return w
}

// TestMergeCannotTargetProtectedAdmin pins the F1 fix: a non-primary admin must
// not be able to merge an OIDC-bearing throwaway *into* the primary admin (which
// would graft that identity onto id 1 and let them sign in as the primary admin).
func TestMergeCannotTargetProtectedAdmin(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	primary, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	attacker, _ := st.CreateUser(ctx, store.UserInput{Username: "attacker", Role: "admin", PasswordHash: ptr("h")})
	throwaway, _ := st.CreateUser(ctx, store.UserInput{Username: "throwaway", Role: "user", OIDCSubject: ptr("attacker-controlled-sub")})
	s := NewServer(st, Options{ProtectedUserID: primary.ID})

	w := mergeCall(t, s, attacker, map[string]any{"sourceId": throwaway.ID, "targetId": primary.ID, "moveData": true})
	if w.Code != http.StatusForbidden {
		t.Fatalf("merge into protected admin = %d, want 403", w.Code)
	}
	// The OIDC subject must NOT have been grafted onto the primary admin.
	if _, err := st.GetUserByOIDCSubject(ctx, "attacker-controlled-sub"); err == nil {
		if got, _ := st.GetUserByID(ctx, primary.ID); got.OIDCLinked {
			t.Fatal("attacker subject was grafted onto the primary admin")
		}
	}
	again, _ := st.GetUserByID(ctx, primary.ID)
	if again.OIDCLinked {
		t.Fatal("primary admin must not have an OIDC link after a blocked merge")
	}
	// The throwaway should be untouched (merge didn't run).
	if _, err := st.GetUserByID(ctx, throwaway.ID); err != nil {
		t.Fatalf("throwaway should still exist: %v", err)
	}
}

// TestMergeRenameConflictIsFriendly pins F5: a kept-username belonging to a third
// account is rejected with a clean 409, not a raw SQLite error.
func TestMergeRenameConflictIsFriendly(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	src, _ := st.CreateUser(ctx, store.UserInput{Username: "src", Role: "user", PasswordHash: ptr("h")})
	tgt, _ := st.CreateUser(ctx, store.UserInput{Username: "tgt", Role: "user", PasswordHash: ptr("h")})
	_, _ = st.CreateUser(ctx, store.UserInput{Username: "taken", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})

	w := mergeCall(t, s, admin, map[string]any{"sourceId": src.ID, "targetId": tgt.ID, "newUsername": "taken"})
	if w.Code != http.StatusConflict {
		t.Fatalf("rename conflict = %d, want 409", w.Code)
	}
	var resp map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if msg := resp["error"]; msg != "that username is taken" {
		t.Fatalf("error = %q, want a friendly message with no raw SQL", msg)
	}
	// Nothing should have changed: both accounts still exist.
	if _, err := st.GetUserByID(ctx, src.ID); err != nil {
		t.Fatalf("source should be intact after a rejected merge: %v", err)
	}
}

// TestMergeStillWorks is a sanity check that the guards don't block a legit merge.
func TestMergeStillWorks(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	src, _ := st.CreateUser(ctx, store.UserInput{Username: "src", Role: "user", OIDCSubject: ptr("sub-x")})
	tgt, _ := st.CreateUser(ctx, store.UserInput{Username: "tgt", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: admin.ID})

	w := mergeCall(t, s, admin, map[string]any{"sourceId": src.ID, "targetId": tgt.ID, "moveData": true})
	if w.Code != http.StatusOK {
		t.Fatalf("legit merge = %d, want 200", w.Code)
	}
	if _, err := st.GetUserByID(ctx, src.ID); err == nil {
		t.Fatal("source should be deleted after a merge")
	}
	// The source's OIDC link transfers to the target (which had none).
	got, _ := st.GetUserByID(ctx, tgt.ID)
	if !got.OIDCLinked {
		t.Fatal("target should have received the source's OIDC link")
	}
}
