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
	if err := st.MarkReminded(ctx, due.ID, dueAt); err != nil {
		t.Fatalf("MarkReminded: %v", err)
	}
	cands, _ = st.ListReminderCandidates(ctx)
	if len(cands) != 1 || cands[0].LastRemindedDue != dueAt.UTC().Format(timeLayout) {
		t.Fatalf("expected last_reminded_due recorded, got %+v", cands)
	}
}
