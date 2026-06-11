package store

import (
	"context"
	"errors"
	"testing"
)

func TestMergeUsersMovesDataAndOIDC(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	src, _ := st.CreateUser(ctx, UserInput{Username: "akadmin", Role: "user"})
	tgt, _ := st.CreateUser(ctx, UserInput{Username: "admin", Role: "admin"})
	if err := st.LinkOIDCSubject(ctx, src.ID, "sub-123"); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateTask(ctx, src.ID, TaskInput{Name: "from-source"}); err != nil {
		t.Fatal(err)
	}

	if err := st.MergeUsers(ctx, src.ID, tgt.ID, true, ""); err != nil {
		t.Fatalf("MergeUsers: %v", err)
	}
	if _, err := st.GetUserByID(ctx, src.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("source should be deleted: %v", err)
	}
	if u, err := st.GetUserByOIDCSubject(ctx, "sub-123"); err != nil || u.ID != tgt.ID {
		t.Fatalf("OIDC subject should resolve to the target now: %+v %v", u, err)
	}
	if tasks, _ := st.ListTasks(ctx, tgt.ID); len(tasks) != 1 || tasks[0].Name != "from-source" {
		t.Fatalf("source's task should have moved to the target: %+v", tasks)
	}
}

func TestMergeUsersDiscardDataAndRename(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	src, _ := st.CreateUser(ctx, UserInput{Username: "old", Role: "user"})
	tgt, _ := st.CreateUser(ctx, UserInput{Username: "keep", Role: "admin"})
	if _, err := st.CreateTask(ctx, src.ID, TaskInput{Name: "doomed"}); err != nil {
		t.Fatal(err)
	}

	// moveData=false discards the source's tasks; rename target to the now-free name.
	if err := st.MergeUsers(ctx, src.ID, tgt.ID, false, "old"); err != nil {
		t.Fatalf("MergeUsers: %v", err)
	}
	if tasks, _ := st.ListTasks(ctx, tgt.ID); len(tasks) != 0 {
		t.Fatalf("source tasks should be discarded, got %+v", tasks)
	}
	if u, _ := st.GetUserByID(ctx, tgt.ID); u.Username != "old" {
		t.Fatalf("target should be renamed to 'old', got %q", u.Username)
	}
}

func TestMergeUsersSelf(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	u, _ := st.CreateUser(ctx, UserInput{Username: "x", Role: "user"})
	if err := st.MergeUsers(ctx, u.ID, u.ID, true, ""); err == nil {
		t.Fatal("merging an account into itself should error")
	}
}
