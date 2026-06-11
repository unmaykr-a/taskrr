package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateDBFile(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	name, err := st.Backup(ctx)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if err := st.ValidateDBFile(filepath.Join(st.BackupsDir(), name)); err != nil {
		t.Fatalf("a real backup should validate: %v", err)
	}

	junk := filepath.Join(t.TempDir(), "junk.db")
	if err := os.WriteFile(junk, []byte("not a database"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := st.ValidateDBFile(junk); err == nil {
		t.Fatal("a garbage file should not validate as a Taskrr database")
	}
}

func TestRestoreCycle(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "test.db")
	st, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	if _, err := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"}); err != nil {
		t.Fatalf("create alice: %v", err)
	}
	name, err := st.Backup(ctx) // snapshot contains alice
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	if _, err := st.CreateUser(ctx, UserInput{Username: "bob", Role: "user"}); err != nil {
		t.Fatalf("create bob: %v", err)
	}

	if err := st.StageRestoreFromBackup(name); err != nil {
		t.Fatalf("StageRestoreFromBackup: %v", err)
	}
	if _, err := os.Stat(st.restorePath()); err != nil {
		t.Fatalf("restore should be staged: %v", err)
	}
	st.Close()

	// Re-opening applies the staged restore before anything has the DB open.
	st2, err := Open(path)
	if err != nil {
		t.Fatalf("re-Open: %v", err)
	}
	defer st2.Close()

	if _, err := st2.GetUserByUsername(ctx, "alice"); err != nil {
		t.Fatalf("alice (in the backup) should exist after restore: %v", err)
	}
	if _, err := st2.GetUserByUsername(ctx, "bob"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("bob (created after the backup) should be gone after restore: %v", err)
	}
	if _, err := os.Stat(st.restorePath()); !os.IsNotExist(err) {
		t.Fatalf("the staging marker should be consumed by the restore")
	}
}
