package store

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

func TestUserCRUDAndSessions(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	u, err := st.CreateUser(ctx, UserInput{Username: "Alice", PasswordHash: ptr("hash"), Role: "admin"})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	if u.ID == 0 || u.Role != "admin" {
		t.Fatalf("unexpected user: %+v", u)
	}

	// Username lookup is case-insensitive.
	got, err := st.GetUserByUsername(ctx, "alice")
	if err != nil || got.ID != u.ID {
		t.Fatalf("GetUserByUsername (NOCASE) failed: %+v %v", got, err)
	}
	if got.PasswordHash == nil || *got.PasswordHash != "hash" {
		t.Fatalf("password hash not round-tripped: %+v", got.PasswordHash)
	}

	// Duplicate username (case-insensitive) is rejected by the UNIQUE constraint.
	if _, err := st.CreateUser(ctx, UserInput{Username: "ALICE"}); err == nil {
		t.Fatal("expected duplicate username to be rejected")
	}

	if n, _ := st.CountUsers(ctx); n != 1 {
		t.Fatalf("CountUsers = %d, want 1", n)
	}
	if n, _ := st.CountAdmins(ctx); n != 1 {
		t.Fatalf("CountAdmins = %d, want 1", n)
	}

	// Sessions: valid + expired.
	if err := st.CreateSession(ctx, "live", u.ID, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	su, err := st.SessionUser(ctx, "live")
	if err != nil || su.ID != u.ID {
		t.Fatalf("SessionUser(live) = %+v %v", su, err)
	}
	if err := st.CreateSession(ctx, "stale", u.ID, time.Now().Add(-time.Hour)); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, err := st.SessionUser(ctx, "stale"); err != ErrNotFound {
		t.Fatalf("expected expired session to be ErrNotFound, got %v", err)
	}
	if err := st.DeleteSession(ctx, "live"); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
	if _, err := st.SessionUser(ctx, "live"); err != ErrNotFound {
		t.Fatal("expected deleted session to be gone")
	}

	// Settings round-trip + upsert.
	if err := st.SetSetting(ctx, "registration", "local"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if err := st.SetSetting(ctx, "registration", "oidc"); err != nil {
		t.Fatalf("SetSetting (upsert): %v", err)
	}
	if v, ok, _ := st.GetSetting(ctx, "registration"); !ok || v != "oidc" {
		t.Fatalf("GetSetting = %q ok=%v, want oidc", v, ok)
	}
}

func TestEnsureAdminAdoptsOrphanTasks(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	// A task created before auth has a NULL owner (insert directly, since
	// CreateTask now always assigns an owner).
	now := time.Now().UTC().Format(timeLayout)
	res, err := st.db.ExecContext(ctx,
		`INSERT INTO tasks (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`,
		"pre-auth", "", now, now)
	if err != nil {
		t.Fatalf("insert orphan task: %v", err)
	}
	taskID, _ := res.LastInsertId()

	admin, err := st.EnsureAdmin(ctx, "admin", ptr("hash"))
	if err != nil {
		t.Fatalf("EnsureAdmin: %v", err)
	}
	if admin.Role != "admin" {
		t.Fatalf("bootstrap user should be admin, got %q", admin.Role)
	}

	var owner sql.NullInt64
	if err := st.db.QueryRowContext(ctx, `SELECT owner_id FROM tasks WHERE id = ?`, taskID).Scan(&owner); err != nil {
		t.Fatalf("read owner_id: %v", err)
	}
	if !owner.Valid || owner.Int64 != admin.ID {
		t.Fatalf("orphan task not adopted by admin: owner=%+v admin=%d", owner, admin.ID)
	}

	// Idempotent: a second call returns the same admin, doesn't duplicate.
	admin2, err := st.EnsureAdmin(ctx, "admin", nil)
	if err != nil || admin2.ID != admin.ID {
		t.Fatalf("EnsureAdmin not idempotent: %+v %v", admin2, err)
	}
	if n, _ := st.CountUsers(ctx); n != 1 {
		t.Fatalf("CountUsers = %d, want 1", n)
	}
}

func TestEnsureAdminRepromotesDemotedBootstrap(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	admin, err := st.EnsureAdmin(ctx, "admin", ptr("hash"))
	if err != nil {
		t.Fatalf("EnsureAdmin: %v", err)
	}

	// Simulate the bootstrap admin having been demoted (the bug this guards).
	if err := st.UpdateUserRole(ctx, admin.ID, "user"); err != nil {
		t.Fatalf("UpdateUserRole: %v", err)
	}

	// A subsequent boot must restore the admin role — it's the only way back,
	// since a demoted primary admin can't be edited by anyone.
	again, err := st.EnsureAdmin(ctx, "admin", nil)
	if err != nil {
		t.Fatalf("EnsureAdmin (recovery): %v", err)
	}
	if again.Role != "admin" {
		t.Fatalf("bootstrap admin not re-promoted, got %q", again.Role)
	}
	got, _ := st.GetUserByID(ctx, admin.ID)
	if got.Role != "admin" {
		t.Fatalf("persisted role not restored, got %q", got.Role)
	}
}
