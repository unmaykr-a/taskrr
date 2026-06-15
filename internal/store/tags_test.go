package store

import (
	"context"
	"reflect"
	"testing"
)

func TestTaskTagsRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	task, err := st.CreateTask(ctx, owner, TaskInput{Name: "x", Tags: []string{"home", "plants"}})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if !reflect.DeepEqual(task.Tags, []string{"home", "plants"}) {
		t.Fatalf("tags not persisted on create: %v", task.Tags)
	}
	got, err := st.GetTask(ctx, owner, task.ID)
	if err != nil || !reflect.DeepEqual(got.Tags, []string{"home", "plants"}) {
		t.Fatalf("tags not read back: %v (err %v)", got.Tags, err)
	}

	// Update replaces tags; clearing yields an empty (non-nil) slice.
	upd, err := st.UpdateTask(ctx, owner, task.ID, TaskInput{Name: "x", Tags: nil})
	if err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if upd.Tags == nil || len(upd.Tags) != 0 {
		t.Fatalf("expected empty tags after clear, got %#v", upd.Tags)
	}

	// A task created without tags reads back as an empty slice, not null.
	plain, _ := st.CreateTask(ctx, owner, TaskInput{Name: "y"})
	if plain.Tags == nil || len(plain.Tags) != 0 {
		t.Fatalf("expected empty tags by default, got %#v", plain.Tags)
	}
}

func TestTaskFolderRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner := testOwner(t, st)

	task, err := st.CreateTask(ctx, owner, TaskInput{Name: "x", Folder: "Home"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if task.Folder != "Home" {
		t.Fatalf("folder not persisted on create: %q", task.Folder)
	}
	got, _ := st.GetTask(ctx, owner, task.ID)
	if got.Folder != "Home" {
		t.Fatalf("folder not read back: %q", got.Folder)
	}
	upd, _ := st.UpdateTask(ctx, owner, task.ID, TaskInput{Name: "x", Folder: ""})
	if upd.Folder != "" {
		t.Fatalf("expected folder cleared, got %q", upd.Folder)
	}
}
