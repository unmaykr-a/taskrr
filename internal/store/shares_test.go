package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// makeUser creates a user with the given name and returns its id.
func makeUser(t *testing.T, st *Store, name string) int64 {
	t.Helper()
	u, err := st.CreateUser(context.Background(), UserInput{Username: name})
	if err != nil {
		t.Fatalf("CreateUser(%s): %v", name, err)
	}
	if !u.AllowShares {
		t.Fatalf("new user %s should default to AllowShares=true", name)
	}
	return u.ID
}

// shareTask creates a task owned by owner and returns its id.
func makeTask(t *testing.T, st *Store, owner int64, name string) int64 {
	t.Helper()
	task, err := st.CreateTask(context.Background(), owner, TaskInput{Name: name})
	if err != nil {
		t.Fatalf("CreateTask(%s): %v", name, err)
	}
	if task.OwnerID != owner {
		t.Fatalf("task OwnerID = %d, want %d", task.OwnerID, owner)
	}
	return task.ID
}

// visible reports whether ListTasks for user includes taskID.
func visible(t *testing.T, st *Store, user, taskID int64) bool {
	t.Helper()
	tasks, err := st.ListTasks(context.Background(), user)
	if err != nil {
		t.Fatalf("ListTasks: %v", err)
	}
	for _, tk := range tasks {
		if tk.ID == taskID {
			return true
		}
	}
	return false
}

func TestShareAcceptMakesTaskVisible(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	task := makeTask(t, st, alice, "Water the plants")

	share, err := st.ShareTask(ctx, alice, task, bob)
	if err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if share.Status != "pending" {
		t.Fatalf("new share status = %q, want pending", share.Status)
	}

	// Pending: bob sees it only as a request, not among his tasks, and can't log it.
	if visible(t, st, bob, task) {
		t.Fatal("pending share should not be visible in bob's task list")
	}
	if _, err := st.GetTask(ctx, bob, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetTask(bob) on pending share = %v, want ErrNotFound", err)
	}
	if _, err := st.AddCompletion(ctx, bob, task, time.Now(), ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AddCompletion(bob) on pending share = %v, want ErrNotFound", err)
	}
	reqs, err := st.ListIncomingShares(ctx, bob)
	if err != nil {
		t.Fatalf("ListIncomingShares: %v", err)
	}
	if len(reqs) != 1 || reqs[0].TaskID != task || reqs[0].OwnerName != "alice" || reqs[0].TaskName != "Water the plants" {
		t.Fatalf("unexpected incoming shares: %+v", reqs)
	}

	// Accept: now visible to bob, and gone from his requests.
	if err := st.RespondToShare(ctx, bob, task, true); err != nil {
		t.Fatalf("RespondToShare accept: %v", err)
	}
	if !visible(t, st, bob, task) {
		t.Fatal("accepted share should be visible in bob's task list")
	}
	if _, err := st.GetTask(ctx, bob, task); err != nil {
		t.Fatalf("GetTask(bob) after accept: %v", err)
	}
	if reqs, _ := st.ListIncomingShares(ctx, bob); len(reqs) != 0 {
		t.Fatalf("accepted share should clear from requests, got %+v", reqs)
	}
	// Owner still sees it too.
	if !visible(t, st, alice, task) {
		t.Fatal("owner should still see a shared task")
	}

	members, err := st.ListTaskMembers(ctx, task)
	if err != nil {
		t.Fatalf("ListTaskMembers: %v", err)
	}
	if len(members) != 2 || members[0].Status != "owner" || members[0].UserID != alice ||
		members[1].UserID != bob || members[1].Status != "accepted" {
		t.Fatalf("unexpected members: %+v", members)
	}
}

func TestShareRejectedCases(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	carol := makeUser(t, st, "carol")
	task := makeTask(t, st, alice, "Back up the NAS")

	// Sharing with yourself.
	if _, err := st.ShareTask(ctx, alice, task, alice); !errors.Is(err, ErrShareSelf) {
		t.Fatalf("share self = %v, want ErrShareSelf", err)
	}
	// Non-owner can't share.
	if _, err := st.ShareTask(ctx, bob, task, carol); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-owner share = %v, want ErrNotFound", err)
	}
	// Unknown task / unknown recipient.
	if _, err := st.ShareTask(ctx, alice, 9999, bob); !errors.Is(err, ErrNotFound) {
		t.Fatalf("share unknown task = %v, want ErrNotFound", err)
	}
	if _, err := st.ShareTask(ctx, alice, task, 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("share to unknown user = %v, want ErrNotFound", err)
	}
	// Duplicate share.
	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("first share: %v", err)
	}
	if _, err := st.ShareTask(ctx, alice, task, bob); !errors.Is(err, ErrAlreadyShared) {
		t.Fatalf("duplicate share = %v, want ErrAlreadyShared", err)
	}
	// Opted-out recipient.
	if err := st.SetUserAllowShares(ctx, carol, false); err != nil {
		t.Fatalf("SetUserAllowShares: %v", err)
	}
	if got, err := st.GetUserAllowShares(ctx, carol); err != nil || got {
		t.Fatalf("GetUserAllowShares(carol) = %v,%v; want false,nil", got, err)
	}
	if _, err := st.ShareTask(ctx, alice, task, carol); !errors.Is(err, ErrShareNotAllowed) {
		t.Fatalf("share to opted-out user = %v, want ErrShareNotAllowed", err)
	}
}

func TestDeclineShareLeavesTaskWithOwner(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	task := makeTask(t, st, alice, "Vacuum")

	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, bob, task, false); err != nil {
		t.Fatalf("RespondToShare decline: %v", err)
	}
	if visible(t, st, bob, task) {
		t.Fatal("declined share should not be visible to bob")
	}
	if !visible(t, st, alice, task) {
		t.Fatal("declined share: task should remain alice's")
	}
	// Declining again (no pending row) is ErrNotFound.
	if err := st.RespondToShare(ctx, bob, task, true); !errors.Is(err, ErrNotFound) {
		t.Fatalf("respond with no pending share = %v, want ErrNotFound", err)
	}
}

func TestMemberLogsRecordActorAndPermissions(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	task := makeTask(t, st, alice, "Clean the litter box")
	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, bob, task, true); err != nil {
		t.Fatalf("accept: %v", err)
	}

	// Each member logs; the actor is recorded.
	aliceC, err := st.AddCompletion(ctx, alice, task, time.Now().Add(-2*time.Hour), "alice did it")
	if err != nil {
		t.Fatalf("AddCompletion(alice): %v", err)
	}
	if aliceC.UserID == nil || *aliceC.UserID != alice {
		t.Fatalf("alice completion UserID = %v, want %d", aliceC.UserID, alice)
	}
	bobC, err := st.AddCompletion(ctx, bob, task, time.Now().Add(-1*time.Hour), "bob did it")
	if err != nil {
		t.Fatalf("AddCompletion(bob): %v", err)
	}
	if bobC.UserID == nil || *bobC.UserID != bob {
		t.Fatalf("bob completion UserID = %v, want %d", bobC.UserID, bob)
	}

	// Both see the full shared history.
	for _, u := range []int64{alice, bob} {
		cs, err := st.ListCompletions(ctx, u, task)
		if err != nil {
			t.Fatalf("ListCompletions(%d): %v", u, err)
		}
		if len(cs) != 2 {
			t.Fatalf("user %d sees %d completions, want 2", u, len(cs))
		}
	}

	// A member may edit/delete their own entry, but not the owner's.
	if _, err := st.UpdateCompletion(ctx, bob, bobC.ID, bobC.CompletedAt, "edited"); err != nil {
		t.Fatalf("bob editing own completion: %v", err)
	}
	if _, err := st.UpdateCompletion(ctx, bob, aliceC.ID, aliceC.CompletedAt, "nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("bob editing alice's completion = %v, want ErrNotFound", err)
	}
	if err := st.DeleteCompletion(ctx, bob, aliceC.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("bob deleting alice's completion = %v, want ErrNotFound", err)
	}
	// The owner may edit/delete anyone's entry.
	if _, err := st.UpdateCompletion(ctx, alice, bobC.ID, bobC.CompletedAt, "owner edit"); err != nil {
		t.Fatalf("alice editing bob's completion: %v", err)
	}
	if err := st.DeleteCompletion(ctx, alice, bobC.ID); err != nil {
		t.Fatalf("alice deleting bob's completion: %v", err)
	}
}

func TestLeaveKeepsHistoryForOwner(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	task := makeTask(t, st, alice, "Shared chore")
	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, bob, task, true); err != nil {
		t.Fatalf("accept: %v", err)
	}
	bobC, err := st.AddCompletion(ctx, bob, task, time.Now(), "bob logged")
	if err != nil {
		t.Fatalf("AddCompletion(bob): %v", err)
	}

	// Bob leaves: the task and bob's logged history persist for alice.
	if err := st.LeaveTask(ctx, bob, task); err != nil {
		t.Fatalf("LeaveTask: %v", err)
	}
	if visible(t, st, bob, task) {
		t.Fatal("bob should not see the task after leaving")
	}
	if !visible(t, st, alice, task) {
		t.Fatal("alice should still own the task after bob leaves")
	}
	cs, err := st.ListCompletions(ctx, alice, task)
	if err != nil {
		t.Fatalf("ListCompletions(alice): %v", err)
	}
	if len(cs) != 1 || cs[0].ID != bobC.ID {
		t.Fatalf("alice should still see bob's completion, got %+v", cs)
	}
	// An ex-member can no longer edit the entry they left behind.
	if _, err := st.UpdateCompletion(ctx, bob, bobC.ID, bobC.CompletedAt, "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ex-member editing left-behind completion = %v, want ErrNotFound", err)
	}
	// Leaving when not a member is ErrNotFound.
	if err := st.LeaveTask(ctx, bob, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("leaving twice = %v, want ErrNotFound", err)
	}
}

func TestDeleteByMemberIsLeave(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	task := makeTask(t, st, alice, "Chore")
	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, bob, task, true); err != nil {
		t.Fatalf("accept: %v", err)
	}

	// A member "deleting" the task only removes their own membership.
	if err := st.DeleteTask(ctx, bob, task); err != nil {
		t.Fatalf("DeleteTask(member): %v", err)
	}
	if visible(t, st, bob, task) {
		t.Fatal("member delete should remove their access")
	}
	if !visible(t, st, alice, task) {
		t.Fatal("member delete must not remove the task from the owner")
	}
}

func TestDeleteByOwnerTransfersToEarliestMember(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	carol := makeUser(t, st, "carol")
	task := makeTask(t, st, alice, "Group task")

	for _, u := range []int64{bob, carol} {
		if _, err := st.ShareTask(ctx, alice, task, u); err != nil {
			t.Fatalf("ShareTask(%d): %v", u, err)
		}
		if err := st.RespondToShare(ctx, u, task, true); err != nil {
			t.Fatalf("accept(%d): %v", u, err)
		}
	}
	// Give the task history so we can prove it survives the transfer.
	if _, err := st.AddCompletion(ctx, alice, task, time.Now(), "logged"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	// Owner deletes: ownership transfers to the earliest accepted member (bob).
	if err := st.DeleteTask(ctx, alice, task); err != nil {
		t.Fatalf("DeleteTask(owner with members): %v", err)
	}
	got, err := st.GetTask(ctx, bob, task)
	if err != nil {
		t.Fatalf("GetTask(bob) after transfer: %v", err)
	}
	if got.OwnerID != bob {
		t.Fatalf("ownership transferred to %d, want bob (%d)", got.OwnerID, bob)
	}
	if got.CompletionCount != 1 {
		t.Fatalf("history lost on transfer: completionCount = %d", got.CompletionCount)
	}
	// The original owner loses access; carol stays on as a member.
	if _, err := st.GetTask(ctx, alice, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetTask(alice) after transfer = %v, want ErrNotFound", err)
	}
	if !visible(t, st, carol, task) {
		t.Fatal("carol should still see the task after the transfer")
	}
	members, err := st.ListTaskMembers(ctx, task)
	if err != nil {
		t.Fatalf("ListTaskMembers: %v", err)
	}
	if len(members) != 2 || members[0].UserID != bob || members[0].Status != "owner" ||
		members[1].UserID != carol || members[1].Status != "accepted" {
		t.Fatalf("unexpected members after transfer: %+v", members)
	}
}

func TestDeleteByOwnerNoMembersRemovesTask(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	task := makeTask(t, st, alice, "Solo task")
	if _, err := st.AddCompletion(ctx, alice, task, time.Now(), ""); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	if err := st.DeleteTask(ctx, alice, task); err != nil {
		t.Fatalf("DeleteTask: %v", err)
	}
	if _, err := st.GetTask(ctx, alice, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetTask after delete = %v, want ErrNotFound", err)
	}
	// Deleting again is ErrNotFound.
	if err := st.DeleteTask(ctx, alice, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("delete missing task = %v, want ErrNotFound", err)
	}
}

func TestSharesAreIsolatedFromOtherUsers(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice := makeUser(t, st, "alice")
	bob := makeUser(t, st, "bob")
	stranger := makeUser(t, st, "stranger")
	task := makeTask(t, st, alice, "Private-ish")
	if _, err := st.ShareTask(ctx, alice, task, bob); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, bob, task, true); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if visible(t, st, stranger, task) {
		t.Fatal("an unrelated user must not see a shared task")
	}
	if _, err := st.GetTask(ctx, stranger, task); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetTask(stranger) = %v, want ErrNotFound", err)
	}
}

func TestGetUserAllowSharesUnknownUser(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.GetUserAllowShares(context.Background(), 9999); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetUserAllowShares(unknown) = %v, want ErrNotFound", err)
	}
}
