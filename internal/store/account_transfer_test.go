package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// shareAndAccept shares taskID from owner to member and accepts it.
func shareAndAccept(t *testing.T, st *Store, owner, member, taskID int64) {
	t.Helper()
	ctx := context.Background()
	if _, err := st.ShareTask(ctx, owner, taskID, member); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, member, taskID, true); err != nil {
		t.Fatalf("RespondToShare: %v", err)
	}
}

func TestDeleteUserTransfersSharedTasks(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	shared := makeTask(t, st, alice, "shared")
	solo := makeTask(t, st, alice, "solo")
	shareAndAccept(t, st, alice, bob, shared)
	if _, err := st.AddCompletion(ctx, alice, shared, time.Now(), "alice logged"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	// Deleting alice's account transfers the shared task to bob and removes solo.
	if err := st.DeleteUser(ctx, alice); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	got, err := st.GetTask(ctx, bob, shared)
	if err != nil {
		t.Fatalf("GetTask(bob, shared) after owner delete: %v", err)
	}
	if got.OwnerID != bob {
		t.Fatalf("shared task owner = %d, want bob (%d)", got.OwnerID, bob)
	}
	if got.CompletionCount != 1 {
		t.Fatalf("history lost on transfer: completionCount = %d", got.CompletionCount)
	}
	// The departed owner's completion survives, now attributed to nobody.
	cs, err := st.ListCompletions(ctx, bob, shared)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}
	if len(cs) != 1 || cs[0].UserID != nil {
		t.Fatalf("expected one orphan-authored completion, got %+v", cs)
	}
	// Bob is no longer a member (he's the owner); no stray share row.
	members, _ := st.ListTaskMembers(ctx, shared)
	if len(members) != 1 || members[0].Status != "owner" || members[0].UserID != bob {
		t.Fatalf("unexpected members after transfer: %+v", members)
	}
	// The solo task was cascaded away with the account.
	if _, err := st.GetTask(ctx, bob, solo); !errors.Is(err, ErrNotFound) {
		t.Fatalf("solo task should be gone, GetTask = %v", err)
	}
}

func TestWipeMyDataTransfersSharedTasks(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	shared := makeTask(t, st, alice, "shared")
	_ = makeTask(t, st, alice, "solo")
	shareAndAccept(t, st, alice, bob, shared)

	// Wiping alice's data deletes only her solo task; the shared one moves to bob.
	n, err := st.DeleteTasksByOwner(ctx, alice)
	if err != nil {
		t.Fatalf("DeleteTasksByOwner: %v", err)
	}
	if n != 1 {
		t.Fatalf("deleted count = %d, want 1 (solo only)", n)
	}
	if got, err := st.GetTask(ctx, bob, shared); err != nil || got.OwnerID != bob {
		t.Fatalf("shared task should belong to bob now: task=%+v err=%v", got, err)
	}
	if visible(t, st, alice, shared) {
		t.Fatal("alice should no longer see the task she left by wiping data")
	}
}

func TestMergeWithoutMoveDataTransfersShared(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	carol := makeUser(t, st, "carol") // merge target
	shared := makeTask(t, st, alice, "shared")
	shareAndAccept(t, st, alice, bob, shared)

	// Fold alice into carol without moving data: alice's shared task goes to its
	// member (bob), not to carol.
	if err := st.MergeUsers(ctx, alice, carol, false, ""); err != nil {
		t.Fatalf("MergeUsers: %v", err)
	}
	if got, err := st.GetTask(ctx, bob, shared); err != nil || got.OwnerID != bob {
		t.Fatalf("shared task should transfer to bob: task=%+v err=%v", got, err)
	}
	if visible(t, st, carol, shared) {
		t.Fatal("carol should not receive the task in a no-move merge")
	}
}

func TestMergeWithMoveDataReassignsAndDedups(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	carol := makeUser(t, st, "carol") // merge target, already a member
	shared := makeTask(t, st, alice, "shared")
	shareAndAccept(t, st, alice, carol, shared)
	if _, err := st.AddCompletion(ctx, alice, shared, time.Now(), "alice logged"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	// Fold alice into carol, moving data: carol owns the task, the redundant
	// membership row is gone, and alice's completion authorship becomes carol's.
	if err := st.MergeUsers(ctx, alice, carol, true, ""); err != nil {
		t.Fatalf("MergeUsers: %v", err)
	}
	got, err := st.GetTask(ctx, carol, shared)
	if err != nil || got.OwnerID != carol {
		t.Fatalf("carol should own the task after move-merge: task=%+v err=%v", got, err)
	}
	members, _ := st.ListTaskMembers(ctx, shared)
	if len(members) != 1 || members[0].Status != "owner" || members[0].UserID != carol {
		t.Fatalf("owner should not also be a member after merge: %+v", members)
	}
	cs, err := st.ListCompletions(ctx, carol, shared)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}
	if len(cs) != 1 || cs[0].UserID == nil || *cs[0].UserID != carol {
		t.Fatalf("completion authorship should fold into carol, got %+v", cs)
	}
}
