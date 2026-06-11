package api

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/andri1305/taskrr/internal/store"
)

// openStore opens a real (temp-file) store for the api-level tests.
func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func ptr(s string) *string { return &s }

// TestSyncOIDCRoleNeverDemotesLocalOrProtected pins the fix for the bug where
// signing in via a linked OIDC identity (not in the admin group) stripped admin
// from a locally-managed or primary account.
func TestSyncOIDCRoleNeverDemotesLocalOrProtected(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)

	// Two admins so the "never demote the last admin" guard isn't what's saving us.
	primary, err := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("hash")})
	if err != nil {
		t.Fatalf("create primary: %v", err)
	}
	localAdmin, err := st.CreateUser(ctx, store.UserInput{Username: "localadmin", Role: "admin", PasswordHash: ptr("hash")})
	if err != nil {
		t.Fatalf("create localAdmin: %v", err)
	}
	oidcAdmin, err := st.CreateUser(ctx, store.UserInput{Username: "oidcadmin", Role: "admin", OIDCSubject: ptr("sub-oidc")})
	if err != nil {
		t.Fatalf("create oidcAdmin: %v", err)
	}

	s := NewServer(st, Options{ProtectedUserID: primary.ID})

	reload := func(id int64) string {
		u, err := st.GetUserByID(ctx, id)
		if err != nil {
			t.Fatalf("GetUserByID: %v", err)
		}
		return u.Role
	}

	// desiredAdmin=false (not in the admin group) must NOT demote the protected
	// primary admin, nor a locally-managed admin.
	s.syncOIDCRole(ctx, mustGet(t, st, primary.ID), false)
	if got := reload(primary.ID); got != "admin" {
		t.Fatalf("protected admin was demoted: role=%q", got)
	}
	s.syncOIDCRole(ctx, mustGet(t, st, localAdmin.ID), false)
	if got := reload(localAdmin.ID); got != "admin" {
		t.Fatalf("local admin was demoted: role=%q", got)
	}

	// An OIDC-only admin (no local password, not protected) IS governed by the
	// group: dropping out of the admin group demotes it.
	s.syncOIDCRole(ctx, mustGet(t, st, oidcAdmin.ID), false)
	if got := reload(oidcAdmin.ID); got != "user" {
		t.Fatalf("OIDC-only admin should be demoted, role=%q", got)
	}

	// Promotion still works for anyone in the group.
	plainUser, err := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("hash")})
	if err != nil {
		t.Fatalf("create plainUser: %v", err)
	}
	s.syncOIDCRole(ctx, mustGet(t, st, plainUser.ID), true)
	if got := reload(plainUser.ID); got != "admin" {
		t.Fatalf("group member not promoted, role=%q", got)
	}
}

func mustGet(t *testing.T, st *store.Store, id int64) store.User {
	t.Helper()
	u, err := st.GetUserByID(context.Background(), id)
	if err != nil {
		t.Fatalf("GetUserByID(%d): %v", id, err)
	}
	return u
}

// TestResolveOIDCLinkByUsernameGated pins the takeover fix: a first OIDC
// sign-in whose username matches an existing local account must NOT silently
// attach to it unless the admin opted in (oidc_link_username).
func TestResolveOIDCLinkByUsernameGated(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	local, err := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("hash")})
	if err != nil {
		t.Fatalf("create local: %v", err)
	}
	s := NewServer(st, Options{ProtectedUserID: local.ID})

	// Default (setting unset = off): refused with a friendly error, not linked.
	if _, err := s.resolveOIDCUser(ctx, oidcSettings{}, "attacker-sub", "admin", nil); err == nil {
		t.Fatal("matching-username sign-in must be refused when linking is off")
	}
	if u := mustGet(t, st, local.ID); u.OIDCSubject != nil {
		t.Fatalf("subject was linked despite the gate: %v", *u.OIDCSubject)
	}

	// Opted in: the identity links to the existing account.
	if err := st.SetSetting(ctx, keyOIDCLinkUsername, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	u, err := s.resolveOIDCUser(ctx, oidcSettings{}, "legit-sub", "admin", nil)
	if err != nil {
		t.Fatalf("resolveOIDCUser with linking on: %v", err)
	}
	if u.ID != local.ID || u.OIDCSubject == nil || *u.OIDCSubject != "legit-sub" {
		t.Fatalf("expected the local account linked to legit-sub, got %+v", u)
	}
}
