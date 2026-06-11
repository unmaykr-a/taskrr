package store

import (
	"context"
	"errors"
	"testing"
)

func TestDeleteTasksByOwner(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	alice, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})
	bob, _ := st.CreateUser(ctx, UserInput{Username: "bob", Role: "user"})

	for _, name := range []string{"a1", "a2", "a3"} {
		if _, err := st.CreateTask(ctx, alice.ID, TaskInput{Name: name}); err != nil {
			t.Fatalf("CreateTask: %v", err)
		}
	}
	if _, err := st.CreateTask(ctx, bob.ID, TaskInput{Name: "b1"}); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	n, err := st.DeleteTasksByOwner(ctx, alice.ID)
	if err != nil {
		t.Fatalf("DeleteTasksByOwner: %v", err)
	}
	if n != 3 {
		t.Fatalf("deleted %d tasks, want 3", n)
	}

	// Alice's tasks are gone; Bob's are untouched.
	if tasks, _ := st.ListTasks(ctx, alice.ID); len(tasks) != 0 {
		t.Fatalf("alice still has %d tasks", len(tasks))
	}
	if tasks, _ := st.ListTasks(ctx, bob.ID); len(tasks) != 1 {
		t.Fatalf("bob's tasks affected: %d", len(tasks))
	}
	// The account itself survives.
	if _, err := st.GetUserByID(ctx, alice.ID); err != nil {
		t.Fatalf("alice account should survive a data wipe: %v", err)
	}
}

func TestUpdateUsername(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	a, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})
	if _, err := st.CreateUser(ctx, UserInput{Username: "bob", Role: "user"}); err != nil {
		t.Fatalf("CreateUser bob: %v", err)
	}

	// Rename succeeds and is reflected by lookup.
	if err := st.UpdateUsername(ctx, a.ID, "alicia"); err != nil {
		t.Fatalf("UpdateUsername: %v", err)
	}
	got, err := st.GetUserByUsername(ctx, "alicia")
	if err != nil || got.ID != a.ID {
		t.Fatalf("renamed user not found: %+v %v", got, err)
	}

	// Renaming to a taken name (case-insensitively) fails on the UNIQUE index.
	if err := st.UpdateUsername(ctx, a.ID, "BOB"); err == nil {
		t.Fatal("expected error renaming to a taken username")
	}
}

func TestLinkUnlinkOIDCSubject(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	a, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})

	// Link, then the subject resolves to this user and OIDCLinked reports true.
	if err := st.LinkOIDCSubject(ctx, a.ID, "sub-123"); err != nil {
		t.Fatalf("LinkOIDCSubject: %v", err)
	}
	got, err := st.GetUserByOIDCSubject(ctx, "sub-123")
	if err != nil || got.ID != a.ID {
		t.Fatalf("linked subject not found: %+v %v", got, err)
	}
	if !got.OIDCLinked {
		t.Fatal("expected OIDCLinked true after linking")
	}

	// Unlink: the subject no longer resolves and OIDCLinked is false again.
	if err := st.UnlinkOIDCSubject(ctx, a.ID); err != nil {
		t.Fatalf("UnlinkOIDCSubject: %v", err)
	}
	if _, err := st.GetUserByOIDCSubject(ctx, "sub-123"); err == nil {
		t.Fatal("expected subject to be gone after unlink")
	}
	again, err := st.GetUserByID(ctx, a.ID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	if again.OIDCLinked {
		t.Fatal("expected OIDCLinked false after unlink")
	}
}

func TestBackupLifecycle(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	name, err := st.Backup(ctx)
	if err != nil {
		t.Fatalf("Backup: %v", err)
	}
	list, err := st.ListBackups()
	if err != nil || len(list) != 1 || list[0].Name != name {
		t.Fatalf("ListBackups = %+v (err %v), want one named %q", list, err, name)
	}

	if err := st.DeleteBackup(name); err != nil {
		t.Fatalf("DeleteBackup: %v", err)
	}
	if list, _ := st.ListBackups(); len(list) != 0 {
		t.Fatalf("backup not deleted: %+v", list)
	}

	// Bad name and missing file both report not-found (no traversal).
	if err := st.DeleteBackup("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invalid name: got %v, want ErrNotFound", err)
	}
	if err := st.DeleteBackup(name); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing file: got %v, want ErrNotFound", err)
	}
}
