package store

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Folder sharing changes who can see what, so these tests are about visibility
// above all: every query path that returns task data is checked, because a rule
// that leaks through one of them leaks entirely.

type folderFixture struct {
	store *Store
	alice User
	bob   User
	carol User
	// Alice's tasks: two in "Home", one in "Work", one ungrouped.
	home1, home2, work, loose Task
}

func newFolderFixture(t *testing.T) folderFixture {
	t.Helper()
	ctx := context.Background()
	st := newTestStore(t)

	alice, err := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	bob, err := st.CreateUser(ctx, UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	carol, err := st.CreateUser(ctx, UserInput{Username: "carol", Role: "user", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	mk := func(name, folder string) Task {
		task, err := st.CreateTask(ctx, alice.ID, TaskInput{Name: name, Folder: folder})
		if err != nil {
			t.Fatalf("CreateTask: %v", err)
		}
		return task
	}
	return folderFixture{
		store: st, alice: alice, bob: bob, carol: carol,
		home1: mk("water plants", "Home"),
		home2: mk("vacuum", "Home"),
		work:  mk("timesheet", "Work"),
		loose: mk("call mum", ""),
	}
}

func (f folderFixture) shareHomeWithBob(t *testing.T, accept bool) {
	t.Helper()
	ctx := context.Background()
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Home", f.bob.ID); err != nil {
		t.Fatalf("ShareFolder: %v", err)
	}
	if accept {
		if err := f.store.RespondToFolderShare(ctx, f.bob.ID, f.alice.ID, "Home", true); err != nil {
			t.Fatalf("RespondToFolderShare: %v", err)
		}
	}
}

func taskNames(tasks []Task) map[string]bool {
	out := map[string]bool{}
	for _, t := range tasks {
		out[t.Name] = true
	}
	return out
}

func TestFolderShareGrantsExactlyThatFolder(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	bobTasks, err := f.store.ListTasks(ctx, f.bob.ID)
	if err != nil {
		t.Fatalf("ListTasks: %v", err)
	}
	names := taskNames(bobTasks)
	if !names["water plants"] || !names["vacuum"] {
		t.Errorf("bob should see both Home tasks, got %v", names)
	}
	// The blast radius is the point: nothing outside the shared folder.
	if names["timesheet"] {
		t.Error("a Work task leaked through a Home folder share")
	}
	if names["call mum"] {
		t.Error("an ungrouped task leaked through a folder share")
	}
	if len(bobTasks) != 2 {
		t.Errorf("expected exactly 2 visible tasks, got %d", len(bobTasks))
	}
}

func TestPendingFolderShareGrantsNothing(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, false) // invited, not accepted

	tasks, _ := f.store.ListTasks(ctx, f.bob.ID)
	if len(tasks) != 0 {
		t.Fatalf("a pending invite must grant no access, got %d task(s)", len(tasks))
	}
	if _, err := f.store.GetTask(ctx, f.bob.ID, f.home1.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetTask through a pending share = %v, want ErrNotFound", err)
	}
}

// Every read path has to agree. A rule enforced in ListTasks but not in
// ListCompletions is not a rule.
func TestFolderShareAppliesToEveryReadPath(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	when := time.Now().UTC().Add(-time.Hour)
	if _, err := f.store.AddCompletion(ctx, f.alice.ID, f.home1.ID, when, "alice did it"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	if _, err := f.store.AddCompletion(ctx, f.alice.ID, f.work.ID, when, "private"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}

	t.Run("GetTask", func(t *testing.T) {
		if _, err := f.store.GetTask(ctx, f.bob.ID, f.home1.ID); err != nil {
			t.Errorf("bob should reach a Home task: %v", err)
		}
		if _, err := f.store.GetTask(ctx, f.bob.ID, f.work.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("bob reached a Work task: %v", err)
		}
	})

	t.Run("ListCompletions", func(t *testing.T) {
		got, err := f.store.ListCompletions(ctx, f.bob.ID, f.home1.ID)
		if err != nil || len(got) != 1 {
			t.Errorf("bob should see the shared task's history, got %d (%v)", len(got), err)
		}
		if got, _ := f.store.ListCompletions(ctx, f.bob.ID, f.work.ID); len(got) != 0 {
			t.Errorf("bob saw a Work task's history: %d row(s)", len(got))
		}
	})

	t.Run("ListActivity", func(t *testing.T) {
		acts, err := f.store.ListActivity(ctx, f.bob.ID, when.Add(-time.Hour), time.Now().UTC().Add(time.Hour))
		if err != nil {
			t.Fatalf("ListActivity: %v", err)
		}
		for _, a := range acts {
			if a.TaskID == f.work.ID {
				t.Error("a Work completion leaked into bob's activity feed")
			}
		}
		if len(acts) != 1 {
			t.Errorf("expected 1 visible completion, got %d", len(acts))
		}
	})

	t.Run("AddCompletion", func(t *testing.T) {
		// A member of a shared folder can log, which is the point of sharing.
		if _, err := f.store.AddCompletion(ctx, f.bob.ID, f.home2.ID, time.Now().UTC(), "bob did it"); err != nil {
			t.Errorf("bob should be able to log a shared task: %v", err)
		}
		if _, err := f.store.AddCompletion(ctx, f.bob.ID, f.work.ID, time.Now().UTC(), "nope"); !errors.Is(err, ErrNotFound) {
			t.Errorf("bob logged a Work task: %v", err)
		}
	})
}

// Membership follows the folder, not a snapshot taken when it was shared.
func TestFolderMembershipFollowsTheFolder(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	t.Run("a task created in the folder later is included", func(t *testing.T) {
		later, err := f.store.CreateTask(ctx, f.alice.ID, TaskInput{Name: "dust shelves", Folder: "Home"})
		if err != nil {
			t.Fatalf("CreateTask: %v", err)
		}
		if _, err := f.store.GetTask(ctx, f.bob.ID, later.ID); err != nil {
			t.Errorf("a task added to the shared folder should be visible: %v", err)
		}
	})

	t.Run("moving a task in grants access", func(t *testing.T) {
		if _, err := f.store.UpdateTask(ctx, f.alice.ID, f.work.ID, TaskInput{Name: "timesheet", Folder: "Home"}); err != nil {
			t.Fatalf("UpdateTask: %v", err)
		}
		if _, err := f.store.GetTask(ctx, f.bob.ID, f.work.ID); err != nil {
			t.Errorf("a task moved into the shared folder should become visible: %v", err)
		}
	})

	t.Run("moving a task out revokes it", func(t *testing.T) {
		if _, err := f.store.UpdateTask(ctx, f.alice.ID, f.home1.ID, TaskInput{Name: "water plants", Folder: "Private"}); err != nil {
			t.Fatalf("UpdateTask: %v", err)
		}
		if _, err := f.store.GetTask(ctx, f.bob.ID, f.home1.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("a task moved out of the shared folder should stop being visible: %v", err)
		}
	})
}

// A folder share is scoped to one owner's folder of that name, not to the name
// globally — otherwise everyone's "Home" would be one shared folder.
func TestFolderShareIsScopedToOneOwner(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	carolTask, err := f.store.CreateTask(ctx, f.carol.ID, TaskInput{Name: "carol's chore", Folder: "Home"})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if _, err := f.store.GetTask(ctx, f.bob.ID, carolTask.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("bob reached carol's Home folder through alice's share: %v", err)
	}
}

func TestUngroupedTasksAreNeverFolderShared(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)

	// Sharing "" is refused outright...
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "  ", f.bob.ID); !errors.Is(err, ErrFolderEmpty) {
		t.Fatalf("sharing an empty folder = %v, want ErrFolderEmpty", err)
	}
	// ...and an accepted share of a real folder never reaches ungrouped tasks,
	// which the visibility condition guards with `t.folder <> ''`.
	f.shareHomeWithBob(t, true)
	if _, err := f.store.GetTask(ctx, f.bob.ID, f.loose.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("an ungrouped task was reachable: %v", err)
	}
}

func TestLeavingOrUnsharingAFolderRevokesAccess(t *testing.T) {
	ctx := context.Background()

	t.Run("member leaves", func(t *testing.T) {
		f := newFolderFixture(t)
		f.shareHomeWithBob(t, true)
		if err := f.store.LeaveFolder(ctx, f.bob.ID, f.alice.ID, "Home"); err != nil {
			t.Fatalf("LeaveFolder: %v", err)
		}
		if tasks, _ := f.store.ListTasks(ctx, f.bob.ID); len(tasks) != 0 {
			t.Errorf("bob still sees %d task(s) after leaving", len(tasks))
		}
	})

	t.Run("owner removes them", func(t *testing.T) {
		f := newFolderFixture(t)
		f.shareHomeWithBob(t, true)
		if err := f.store.UnshareFolder(ctx, f.alice.ID, "Home", f.bob.ID); err != nil {
			t.Fatalf("UnshareFolder: %v", err)
		}
		if tasks, _ := f.store.ListTasks(ctx, f.bob.ID); len(tasks) != 0 {
			t.Errorf("bob still sees %d task(s) after being removed", len(tasks))
		}
		// Alice keeps everything, of course.
		if tasks, _ := f.store.ListTasks(ctx, f.alice.ID); len(tasks) != 4 {
			t.Errorf("alice lost tasks: %d", len(tasks))
		}
	})
}

func TestFolderShareValidation(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)

	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Home", f.alice.ID); !errors.Is(err, ErrShareSelf) {
		t.Errorf("self-share = %v, want ErrShareSelf", err)
	}
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Nonexistent", f.bob.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown folder = %v, want ErrNotFound", err)
	}
	f.shareHomeWithBob(t, true)
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Home", f.bob.ID); !errors.Is(err, ErrAlreadyShared) {
		t.Errorf("duplicate = %v, want ErrAlreadyShared", err)
	}
	// The recipient's opt-out governs folder shares too.
	if err := f.store.SetUserAllowShares(ctx, f.carol.ID, false); err != nil {
		t.Fatalf("SetUserAllowShares: %v", err)
	}
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Home", f.carol.ID); !errors.Is(err, ErrShareNotAllowed) {
		t.Errorf("opted-out recipient = %v, want ErrShareNotAllowed", err)
	}
}

func TestIncomingFolderSharesDescribeTheOffer(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, false)

	reqs, err := f.store.ListIncomingFolderShares(ctx, f.bob.ID)
	if err != nil {
		t.Fatalf("ListIncomingFolderShares: %v", err)
	}
	if len(reqs) != 1 {
		t.Fatalf("expected 1 invite, got %d", len(reqs))
	}
	if reqs[0].OwnerName != "alice" || reqs[0].Folder != "Home" {
		t.Errorf("invite = %+v", reqs[0])
	}
	// Knowing how much you're accepting matters before you accept it.
	if reqs[0].TaskCount != 2 {
		t.Errorf("taskCount = %d, want 2", reqs[0].TaskCount)
	}

	// Once accepted it is no longer an invitation.
	if err := f.store.RespondToFolderShare(ctx, f.bob.ID, f.alice.ID, "Home", true); err != nil {
		t.Fatalf("respond: %v", err)
	}
	if reqs, _ := f.store.ListIncomingFolderShares(ctx, f.bob.ID); len(reqs) != 0 {
		t.Errorf("an accepted share is still listed as pending: %d", len(reqs))
	}
}

func TestDecliningAFolderShareLetsTheOwnerRetry(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, false)

	if err := f.store.RespondToFolderShare(ctx, f.bob.ID, f.alice.ID, "Home", false); err != nil {
		t.Fatalf("decline: %v", err)
	}
	if tasks, _ := f.store.ListTasks(ctx, f.bob.ID); len(tasks) != 0 {
		t.Error("declining granted access")
	}
	// Declining removes the row rather than remembering a "no", so the owner can
	// ask again — the same behaviour as per-task shares.
	if _, err := f.store.ShareFolder(ctx, f.alice.ID, "Home", f.bob.ID); err != nil {
		t.Errorf("re-inviting after a decline failed: %v", err)
	}
}

// A task reachable both ways should behave, and stay reachable if one route is
// removed.
func TestDirectAndFolderSharesCoexist(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	if _, err := f.store.ShareTask(ctx, f.alice.ID, f.home1.ID, f.bob.ID); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := f.store.RespondToShare(ctx, f.bob.ID, f.home1.ID, true); err != nil {
		t.Fatalf("RespondToShare: %v", err)
	}

	// Listed once, not twice.
	tasks, _ := f.store.ListTasks(ctx, f.bob.ID)
	seen := 0
	for _, task := range tasks {
		if task.ID == f.home1.ID {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("doubly-shared task appears %d times, want 1", seen)
	}

	// Dropping the folder share leaves the direct one intact.
	if err := f.store.LeaveFolder(ctx, f.bob.ID, f.alice.ID, "Home"); err != nil {
		t.Fatalf("LeaveFolder: %v", err)
	}
	if _, err := f.store.GetTask(ctx, f.bob.ID, f.home1.ID); err != nil {
		t.Errorf("the direct share should still grant access: %v", err)
	}
	if _, err := f.store.GetTask(ctx, f.bob.ID, f.home2.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("the folder-only task should be gone: %v", err)
	}
}

// The `shared` flag drives the Shared view and the card's icon, so it has to
// count folder membership too.
func TestSharedFlagCountsFolderShares(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)

	before, _ := f.store.GetTask(ctx, f.alice.ID, f.home1.ID)
	if before.Shared {
		t.Fatal("task reported shared before anything was shared")
	}

	f.shareHomeWithBob(t, true)
	after, _ := f.store.GetTask(ctx, f.alice.ID, f.home1.ID)
	if !after.Shared {
		t.Error("a folder-shared task should report shared")
	}
	// A task outside the folder should not.
	work, _ := f.store.GetTask(ctx, f.alice.ID, f.work.ID)
	if work.Shared {
		t.Error("a task outside the shared folder reported shared")
	}
}

// Sharing a folder should be equivalent to sharing each task in it, reminders
// included — otherwise a household member sees the chore but never gets nudged.
func TestFolderMembersAreReminderRecipients(t *testing.T) {
	ctx := context.Background()
	f := newFolderFixture(t)
	f.shareHomeWithBob(t, true)

	// Give the Home task a routine and some history so it becomes a candidate.
	every := int64(3600)
	if _, err := f.store.UpdateTask(ctx, f.alice.ID, f.home1.ID,
		TaskInput{Name: "water plants", Folder: "Home", IntervalSeconds: &every}); err != nil {
		t.Fatalf("UpdateTask: %v", err)
	}
	if _, err := f.store.AddCompletion(ctx, f.alice.ID, f.home1.ID, time.Now().UTC().Add(-2*time.Hour), ""); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	for _, u := range []User{f.alice, f.bob, f.carol} {
		if err := f.store.SetReminderSettings(ctx, u.ID, ReminderSettings{
			Enabled: true, WebhookURL: "https://example.com/hook", LeadSeconds: 0,
		}); err != nil {
			t.Fatalf("SetReminderSettings: %v", err)
		}
	}

	cands, err := f.store.ListReminderCandidates(ctx)
	if err != nil {
		t.Fatalf("ListReminderCandidates: %v", err)
	}
	recipients := map[int64]bool{}
	for _, c := range cands {
		if c.TaskID == f.home1.ID {
			recipients[c.UserID] = true
		}
	}
	if !recipients[f.alice.ID] {
		t.Error("the owner should be a recipient")
	}
	if !recipients[f.bob.ID] {
		t.Error("a folder member should be a recipient")
	}
	if recipients[f.carol.ID] {
		t.Error("someone with no share became a recipient")
	}
}
