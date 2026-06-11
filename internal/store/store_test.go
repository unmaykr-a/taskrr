package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

// testOwner creates a user and returns its id, for owner-scoped task calls.
func testOwner(t *testing.T, st *Store) int64 {
	t.Helper()
	u, err := st.CreateUser(context.Background(), UserInput{Username: "owner", Role: "admin"})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return u.ID
}

// ptr is a tiny helper to take the address of a literal (Go can't do &7 for an
// int64 directly).
func ptr[T any](v T) *T { return &v }

func TestTaskLifecycleAndCompletions(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	task, err := st.CreateTask(ctx, owner, TaskInput{
		Name:            "Water the plants",
		Description:     "the big ones by the window",
		IntervalSeconds: ptr(int64(7 * 24 * 3600)), // weekly cadence
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if task.ID == 0 || task.Name != "Water the plants" {
		t.Fatalf("unexpected task: %+v", task)
	}
	if task.IntervalSeconds == nil || *task.IntervalSeconds != 7*24*3600 {
		t.Fatalf("interval not persisted: %+v", task.IntervalSeconds)
	}
	if task.LastCompletedAt != nil || task.CompletionCount != 0 {
		t.Fatalf("new task should have no completions: %+v", task)
	}

	when := time.Now().Add(-2 * time.Hour)
	if _, err := st.AddCompletion(ctx, owner, task.ID, when, "used rainwater"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	got, err := st.GetTask(ctx, owner, task.ID)
	if err != nil {
		t.Fatalf("GetTask: %v", err)
	}
	if got.CompletionCount != 1 {
		t.Fatalf("expected 1 completion, got %d", got.CompletionCount)
	}
	if got.LastCompletedAt == nil {
		t.Fatal("expected LastCompletedAt to be set")
	}
	if diff := got.LastCompletedAt.Sub(when.UTC()); diff > time.Second || diff < -time.Second {
		t.Fatalf("LastCompletedAt off by %v", diff)
	}

	completions, err := st.ListCompletions(ctx, owner, task.ID)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}
	if len(completions) != 1 || completions[0].Note != "used rainwater" {
		t.Fatalf("unexpected completions: %+v", completions)
	}
}

func TestUpdateTaskReplacesFieldsAndClearsInterval(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	task, err := st.CreateTask(ctx, owner, TaskInput{Name: "Mop", IntervalSeconds: ptr(int64(3600))})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	// Rename, add a description, and clear the cadence (nil interval).
	updated, err := st.UpdateTask(ctx, owner, task.ID, TaskInput{
		Name:            "Mop the kitchen",
		Description:     "with the good mop",
		IntervalSeconds: nil,
	})
	if err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if updated.Name != "Mop the kitchen" || updated.Description != "with the good mop" {
		t.Fatalf("fields not updated: %+v", updated)
	}
	if updated.IntervalSeconds != nil {
		t.Fatalf("interval should have been cleared, got %v", *updated.IntervalSeconds)
	}
}

func TestTasksAreOwnerScoped(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := testOwner(t, st)
	bob, err := st.CreateUser(ctx, UserInput{Username: "bob"})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	task, err := st.CreateTask(ctx, alice, TaskInput{Name: "Alice's task"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}

	// Bob can't see, get, update, archive, delete, or log against Alice's task.
	if list, err := st.ListTasks(ctx, bob.ID); err != nil || len(list) != 0 {
		t.Fatalf("Bob should see no tasks: %+v %v", list, err)
	}
	if _, err := st.GetTask(ctx, bob.ID, task.ID); err != ErrNotFound {
		t.Fatalf("Bob GetTask should be ErrNotFound, got %v", err)
	}
	if _, err := st.AddCompletion(ctx, bob.ID, task.ID, time.Now(), ""); err != ErrNotFound {
		t.Fatalf("Bob AddCompletion should be ErrNotFound, got %v", err)
	}
	if err := st.DeleteTask(ctx, bob.ID, task.ID); err != ErrNotFound {
		t.Fatalf("Bob DeleteTask should be ErrNotFound, got %v", err)
	}
	// Alice still has it.
	if list, err := st.ListTasks(ctx, alice); err != nil || len(list) != 1 {
		t.Fatalf("Alice should still have her task: %+v %v", list, err)
	}
}

func TestDeleteTaskCascadesCompletions(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	task, err := st.CreateTask(ctx, owner, TaskInput{Name: "Take out the bins"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if _, err := st.AddCompletion(ctx, owner, task.ID, time.Now(), ""); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	if err := st.DeleteTask(ctx, owner, task.ID); err != nil {
		t.Fatalf("DeleteTask: %v", err)
	}

	if _, err := st.GetTask(ctx, owner, task.ID); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound after delete, got %v", err)
	}
	completions, err := st.ListCompletions(ctx, owner, task.ID)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}
	if len(completions) != 0 {
		t.Fatalf("completions should cascade-delete, got %d", len(completions))
	}
}

func TestAddCompletionUnknownTask(t *testing.T) {
	st := newTestStore(t)
	owner := testOwner(t, st)
	if _, err := st.AddCompletion(context.Background(), owner, 999, time.Now(), ""); err != ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestListActivityWithinRange(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	plants, _ := st.CreateTask(ctx, owner, TaskInput{Name: "Plants"})
	bins, _ := st.CreateTask(ctx, owner, TaskInput{Name: "Bins"})

	now := time.Now().UTC()
	inRange := now.Add(-24 * time.Hour)
	outOfRange := now.Add(-72 * time.Hour)

	if _, err := st.AddCompletion(ctx, owner, plants.ID, inRange, "in range"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	if _, err := st.AddCompletion(ctx, owner, bins.ID, outOfRange, "too old"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	from := now.Add(-48 * time.Hour)
	to := now.Add(time.Hour)
	activity, err := st.ListActivity(ctx, owner, from, to)
	if err != nil {
		t.Fatalf("ListActivity: %v", err)
	}
	if len(activity) != 1 {
		t.Fatalf("expected 1 activity in range, got %d", len(activity))
	}
	if activity[0].TaskName != "Plants" || activity[0].Note != "in range" {
		t.Fatalf("unexpected activity row: %+v", activity[0])
	}
}
