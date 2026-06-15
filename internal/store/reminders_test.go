package store

import (
	"context"
	"testing"
	"time"
)

func TestReminderSettingsRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	u, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})

	// Defaults when never configured: disabled, empty.
	got, err := st.GetReminderSettings(ctx, u.ID)
	if err != nil {
		t.Fatalf("GetReminderSettings: %v", err)
	}
	if got.Enabled || got.WebhookURL != "" {
		t.Fatalf("expected disabled defaults, got %+v", got)
	}

	want := ReminderSettings{Enabled: true, WebhookURL: "https://ntfy.sh/topic", LeadSeconds: 3600}
	if err := st.SetReminderSettings(ctx, u.ID, want); err != nil {
		t.Fatalf("SetReminderSettings: %v", err)
	}
	// Upsert (second write) updates in place.
	want.LeadSeconds = 0
	if err := st.SetReminderSettings(ctx, u.ID, want); err != nil {
		t.Fatalf("SetReminderSettings upsert: %v", err)
	}
	got, _ = st.GetReminderSettings(ctx, u.ID)
	if got != want {
		t.Fatalf("round-trip mismatch: got %+v want %+v", got, want)
	}
}

func TestListReminderCandidates(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	alice, _ := st.CreateUser(ctx, UserInput{Username: "alice", Role: "user"})
	bob, _ := st.CreateUser(ctx, UserInput{Username: "bob", Role: "user"})

	// alice has reminders on; bob does not.
	_ = st.SetReminderSettings(ctx, alice.ID, ReminderSettings{Enabled: true, WebhookURL: "https://h/x", LeadSeconds: 0})

	hourly := int64(3600)
	// A completed cadence task (eligible), a never-completed cadence task
	// (excluded), and a no-cadence task (excluded).
	due, _ := st.CreateTask(ctx, alice.ID, TaskInput{Name: "due", IntervalSeconds: &hourly})
	if _, err := st.AddCompletion(ctx, alice.ID, due.ID, time.Now().Add(-2*time.Hour), ""); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	_, _ = st.CreateTask(ctx, alice.ID, TaskInput{Name: "never", IntervalSeconds: &hourly})
	_, _ = st.CreateTask(ctx, alice.ID, TaskInput{Name: "no-cadence"})
	// bob's task shouldn't appear (reminders off).
	bobTask, _ := st.CreateTask(ctx, bob.ID, TaskInput{Name: "bob", IntervalSeconds: &hourly})
	_, _ = st.AddCompletion(ctx, bob.ID, bobTask.ID, time.Now().Add(-2*time.Hour), "")

	cands, err := st.ListReminderCandidates(ctx)
	if err != nil {
		t.Fatalf("ListReminderCandidates: %v", err)
	}
	if len(cands) != 1 || cands[0].TaskID != due.ID {
		t.Fatalf("want only alice's completed cadence task, got %+v", cands)
	}
	if cands[0].WebhookURL != "https://h/x" || cands[0].LastRemindedDue != "" {
		t.Fatalf("unexpected candidate fields: %+v", cands[0])
	}

	// After marking reminded for the current due time, that due time is recorded.
	dueAt := cands[0].LastCompleted.Add(time.Hour)
	if err := st.MarkReminded(ctx, due.ID, cands[0].UserID, dueAt); err != nil {
		t.Fatalf("MarkReminded: %v", err)
	}
	cands, _ = st.ListReminderCandidates(ctx)
	if len(cands) != 1 || cands[0].LastRemindedDue != dueAt.UTC().Format(timeLayout) {
		t.Fatalf("expected last_reminded_due recorded, got %+v", cands)
	}
}

// TestReminderCandidatesIncludeSharedMembers: a task shared with (and accepted
// by) another user who has reminders on yields a candidate for that member, with
// per-recipient dedup independent of the owner.
func TestReminderCandidatesIncludeSharedMembers(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)
	owner, _ := st.CreateUser(ctx, UserInput{Username: "owner", Role: "user"})
	member, _ := st.CreateUser(ctx, UserInput{Username: "member", Role: "user"})
	other, _ := st.CreateUser(ctx, UserInput{Username: "other", Role: "user"})

	// Owner and member have reminders on; "other" does not.
	_ = st.SetReminderSettings(ctx, owner.ID, ReminderSettings{Enabled: true, WebhookURL: "https://h/owner"})
	_ = st.SetReminderSettings(ctx, member.ID, ReminderSettings{Enabled: true, WebhookURL: "https://h/member"})

	hourly := int64(3600)
	task, _ := st.CreateTask(ctx, owner.ID, TaskInput{Name: "shared", IntervalSeconds: &hourly})
	_, _ = st.AddCompletion(ctx, owner.ID, task.ID, time.Now().Add(-2*time.Hour), "")

	// Pending share → member is not yet a candidate.
	if _, err := st.ShareTask(ctx, owner.ID, task.ID, member.ID); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	// "other" is invited too but never accepts → never a candidate.
	if _, err := st.ShareTask(ctx, owner.ID, task.ID, other.ID); err != nil {
		t.Fatalf("ShareTask other: %v", err)
	}
	cands, _ := st.ListReminderCandidates(ctx)
	if len(cands) != 1 || cands[0].UserID != owner.ID {
		t.Fatalf("pending share should yield only the owner, got %+v", cands)
	}

	// Member accepts → now both owner and member are candidates.
	if err := st.RespondToShare(ctx, member.ID, task.ID, true); err != nil {
		t.Fatalf("RespondToShare: %v", err)
	}
	cands, _ = st.ListReminderCandidates(ctx)
	byUser := map[int64]ReminderCandidate{}
	for _, c := range cands {
		byUser[c.UserID] = c
	}
	if len(cands) != 2 || byUser[owner.ID].WebhookURL != "https://h/owner" || byUser[member.ID].WebhookURL != "https://h/member" {
		t.Fatalf("want owner+member candidates with their own webhooks, got %+v", cands)
	}

	// Marking the owner reminded does not suppress the member (per-recipient dedup).
	dueAt := byUser[owner.ID].LastCompleted.Add(time.Hour)
	if err := st.MarkReminded(ctx, task.ID, owner.ID, dueAt); err != nil {
		t.Fatalf("MarkReminded: %v", err)
	}
	cands, _ = st.ListReminderCandidates(ctx)
	for _, c := range cands {
		if c.UserID == owner.ID && c.LastRemindedDue == "" {
			t.Fatal("owner should be marked reminded")
		}
		if c.UserID == member.ID && c.LastRemindedDue != "" {
			t.Fatal("member must still be pending (independent dedup)")
		}
	}
}
