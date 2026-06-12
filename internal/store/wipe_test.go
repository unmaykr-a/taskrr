package store

import (
	"context"
	"testing"
	"time"
)

// TestWipeEverything verifies the full instance reset keeps exactly one thing:
// the acting admin's account (username, password, sessions) — and nothing else.
func TestWipeEverything(t *testing.T) {
	ctx := context.Background()
	st := newTestStore(t)

	admin, _ := st.CreateUser(ctx, UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("hash")})
	other, _ := st.CreateUser(ctx, UserInput{Username: "other", Role: "user", PasswordHash: ptr("hash2")})
	_ = st.CreateSession(ctx, "admin-tok", admin.ID, time.Now().Add(time.Hour))
	_ = st.CreateSession(ctx, "other-tok", other.ID, time.Now().Add(time.Hour))

	task, _ := st.CreateTask(ctx, admin.ID, TaskInput{Name: "admin task"})
	_, _ = st.AddCompletion(ctx, admin.ID, task.ID, time.Now(), "")
	_, _ = st.CreateTask(ctx, other.ID, TaskInput{Name: "other task"})
	_ = st.SetSetting(ctx, "oidc_client_secret", "sensitive")
	_ = st.SetSetting(ctx, "reg_local", "true")
	_ = st.SetUserPreferences(ctx, admin.ID, `{"theme":"x"}`)
	_ = st.SetReminderSettings(ctx, admin.ID, ReminderSettings{Enabled: true, WebhookURL: "http://x"})

	if err := st.WipeEverything(ctx, admin.ID); err != nil {
		t.Fatalf("WipeEverything: %v", err)
	}

	// The admin survives with its password and session.
	kept, err := st.GetUserByID(ctx, admin.ID)
	if err != nil || kept.PasswordHash == nil || *kept.PasswordHash != "hash" {
		t.Fatalf("admin account must survive intact: %+v err=%v", kept, err)
	}
	if _, err := st.SessionUser(ctx, "admin-tok"); err != nil {
		t.Fatalf("admin session should survive: %v", err)
	}

	// Everything else is gone.
	if n, _ := st.CountUsers(ctx); n != 1 {
		t.Fatalf("users = %d, want 1", n)
	}
	if tasks, _ := st.ListTasks(ctx, admin.ID); len(tasks) != 0 {
		t.Fatalf("admin tasks should be wiped, got %d", len(tasks))
	}
	if _, ok, _ := st.GetSetting(ctx, "oidc_client_secret"); ok {
		t.Fatal("settings should be wiped")
	}
	if _, ok, _ := st.GetSetting(ctx, "reg_local"); ok {
		t.Fatal("settings should be wiped")
	}
	if prefs, _ := st.GetUserPreferences(ctx, admin.ID); prefs != "" {
		t.Fatalf("preferences should be wiped, got %q", prefs)
	}
	if rs, _ := st.GetReminderSettings(ctx, admin.ID); rs.Enabled || rs.WebhookURL != "" {
		t.Fatalf("reminder settings should be wiped, got %+v", rs)
	}
	if _, err := st.SessionUser(ctx, "other-tok"); err == nil {
		t.Fatal("other users' sessions should be gone")
	}
}
