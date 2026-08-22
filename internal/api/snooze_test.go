package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

func post(t *testing.T, h http.Handler, path string, cookie *http.Cookie, body string) *httptest.ResponseRecorder {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(http.MethodPost, path, nil)
	} else {
		req = httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeTask(t *testing.T, rec *httptest.ResponseRecorder) store.Task {
	t.Helper()
	var task store.Task
	if err := json.Unmarshal(rec.Body.Bytes(), &task); err != nil {
		t.Fatalf("decode task: %v (body %s)", err, rec.Body.String())
	}
	return task
}

// weeklyTask makes a task with a 7-day routine, last completed `daysAgo` ago.
func weeklyTask(t *testing.T, st *store.Store, ownerID int64, name string, daysAgo float64) store.Task {
	t.Helper()
	ctx := context.Background()
	every := int64(7 * 86400)
	task, err := st.CreateTask(ctx, ownerID, store.TaskInput{Name: name, IntervalSeconds: &every})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	when := time.Now().UTC().Add(-time.Duration(daysAgo * float64(24*time.Hour)))
	if _, err := st.AddCompletion(ctx, ownerID, task.ID, when, ""); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	got, err := st.GetTask(ctx, ownerID, task.ID)
	if err != nil {
		t.Fatalf("GetTask: %v", err)
	}
	return got
}

func TestSnoozeSetsAndClears(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "water plants", 9) // overdue

	until := time.Now().UTC().Add(72 * time.Hour).Truncate(time.Second)
	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/snooze", task.ID), cookie,
		fmt.Sprintf(`{"until":%q}`, until.Format(time.RFC3339)))
	if rec.Code != http.StatusOK {
		t.Fatalf("snooze: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeTask(t, rec)
	if got.SnoozedUntil == nil {
		t.Fatal("expected snoozedUntil to be set")
	}
	if !got.SnoozedUntil.Equal(until) {
		t.Errorf("snoozedUntil = %v, want %v", got.SnoozedUntil, until)
	}

	// An empty body clears it again.
	rec = post(t, h, fmt.Sprintf("/api/tasks/%d/snooze", task.ID), cookie, `{"until":""}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear snooze: got %d", rec.Code)
	}
	if decodeTask(t, rec).SnoozedUntil != nil {
		t.Error("expected snoozedUntil to be cleared")
	}
}

// A snooze already in the past is over, so it should be stored as "not snoozed"
// rather than as a value every reader has to remember to ignore.
func TestSnoozeInThePastIsTreatedAsCleared(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "water plants", 9)

	past := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/snooze", task.ID), cookie, fmt.Sprintf(`{"until":%q}`, past))
	if rec.Code != http.StatusOK {
		t.Fatalf("snooze: got %d", rec.Code)
	}
	if decodeTask(t, rec).SnoozedUntil != nil {
		t.Error("a past snooze should be stored as cleared")
	}
}

func TestSnoozeRejectsBadInput(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "water plants", 1)

	for _, body := range []string{
		`{"until":"next tuesday"}`,
		fmt.Sprintf(`{"until":%q}`, time.Now().UTC().AddDate(3, 0, 0).Format(time.RFC3339)), // beyond the cap
	} {
		rec := post(t, h, fmt.Sprintf("/api/tasks/%d/snooze", task.ID), cookie, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: expected 400, got %d (%s)", body, rec.Code, rec.Body.String())
		}
	}
}

// The heart of the feature: skipping moves the schedule and leaves history alone.
func TestSkipAdvancesDueWithoutLoggingAnything(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "water plants", 6) // due in ~1 day

	before, err := st.ListCompletions(ctx, u.ID, task.ID)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/skip", task.ID), cookie, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("skip: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeTask(t, rec)
	if got.SnoozedUntil == nil {
		t.Fatal("skip should push the due time out")
	}
	// Was due in ~1 day; after one skipped cycle it should be ~8 days out.
	delta := time.Until(*got.SnoozedUntil)
	if delta < 7*24*time.Hour || delta > 9*24*time.Hour {
		t.Errorf("expected the skip to land ~8 days out, got %v", delta)
	}

	// The important half: nothing was recorded as done.
	after, err := st.ListCompletions(ctx, u.ID, task.ID)
	if err != nil {
		t.Fatalf("ListCompletions: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("skip wrote %d completion(s); it must never record history", len(after)-len(before))
	}
	if got.CompletionCount != task.CompletionCount {
		t.Errorf("completionCount changed from %d to %d", task.CompletionCount, got.CompletionCount)
	}
	if got.LastCompletedAt == nil || !got.LastCompletedAt.Equal(*task.LastCompletedAt) {
		t.Error("skip must not move the last-completed time")
	}
}

// Skipping something several cycles overdue has to land in the future, not just
// one interval past a due time that was already in the past.
func TestSkipOnAVeryOverdueTaskLandsInTheFuture(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "descale kettle", 40) // ~5 cycles overdue

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/skip", task.ID), cookie, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("skip: got %d", rec.Code)
	}
	got := decodeTask(t, rec)
	if got.SnoozedUntil == nil || !got.SnoozedUntil.After(time.Now().UTC()) {
		t.Fatalf("skip must land in the future, got %v", got.SnoozedUntil)
	}
	// And no further than one interval ahead of now.
	if time.Until(*got.SnoozedUntil) > 7*24*time.Hour {
		t.Errorf("skip overshot: %v away", time.Until(*got.SnoozedUntil))
	}
}

func TestSkipNeedsARoutine(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	task, _ := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "no routine"})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/skip", task.ID), cookie, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a task with no cycle, got %d", rec.Code)
	}
}

func TestPinToggles(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	task := weeklyTask(t, st, u.ID, "water plants", 1)

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/pin", task.ID), cookie, `{"pinned":true}`)
	if rec.Code != http.StatusOK || !decodeTask(t, rec).Pinned {
		t.Fatalf("pin: got %d, body %s", rec.Code, rec.Body.String())
	}
	rec = post(t, h, fmt.Sprintf("/api/tasks/%d/pin", task.ID), cookie, `{"pinned":false}`)
	if rec.Code != http.StatusOK || decodeTask(t, rec).Pinned {
		t.Fatalf("unpin: got %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestDuplicateCopiesTheDefinitionNotTheHistory(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	every := int64(7 * 86400)
	fresh := "#00ff00"
	src, err := st.CreateTask(ctx, u.ID, store.TaskInput{
		Name: "water plants", Description: "the big ones", IntervalSeconds: &every,
		Tags: []string{"home", "plants"}, Folder: "Home", ColorFresh: &fresh, FreezeColor: true,
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if _, err := st.AddCompletion(ctx, u.ID, src.ID, time.Now().UTC().Add(-48*time.Hour), "done"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	// Snooze the original, to prove the copy doesn't inherit the hold.
	until := time.Now().UTC().Add(48 * time.Hour)
	if _, err := st.SetTaskSnoozed(ctx, u.ID, src.ID, &until); err != nil {
		t.Fatalf("SetTaskSnoozed: %v", err)
	}

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/duplicate", src.ID), cookie, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("duplicate: got %d, body %s", rec.Code, rec.Body.String())
	}
	copied := decodeTask(t, rec)

	if copied.ID == src.ID {
		t.Fatal("duplicate returned the original")
	}
	if copied.Name != "water plants (copy)" {
		t.Errorf("name = %q", copied.Name)
	}
	// Definition carried over.
	if copied.Description != "the big ones" || copied.Folder != "Home" || len(copied.Tags) != 2 {
		t.Errorf("definition not copied: %+v", copied)
	}
	if copied.IntervalSeconds == nil || *copied.IntervalSeconds != every {
		t.Error("routine not copied")
	}
	if copied.ColorFresh == nil || *copied.ColorFresh != fresh || !copied.FreezeColor {
		t.Error("colour settings not copied")
	}
	// History, snooze and archived state deliberately not carried over.
	if copied.CompletionCount != 0 || copied.LastCompletedAt != nil {
		t.Errorf("the copy started with history: count=%d last=%v", copied.CompletionCount, copied.LastCompletedAt)
	}
	if copied.SnoozedUntil != nil {
		t.Error("the copy inherited the original's snooze")
	}
	if copied.ArchivedAt != nil {
		t.Error("the copy started archived")
	}
}

func TestDuplicateAcceptsAName(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	src, _ := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "water plants"})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := post(t, h, fmt.Sprintf("/api/tasks/%d/duplicate", src.ID), cookie, `{"name":"water the office fern"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("duplicate: got %d", rec.Code)
	}
	if got := decodeTask(t, rec).Name; got != "water the office fern" {
		t.Errorf("name = %q", got)
	}
}

// These actions change a task's definition or schedule, so they belong to the
// owner — a member of a shared task must not reach them.
func TestScheduleActionsAreOwnerOnly(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	owner, _ := st.CreateUser(ctx, store.UserInput{Username: "owner", Role: "user", PasswordHash: ptr("h")})
	member, _ := st.CreateUser(ctx, store.UserInput{Username: "member", Role: "user", PasswordHash: ptr("h")})
	task := weeklyTask(t, st, owner.ID, "shared chore", 3)
	if _, err := st.ShareTask(ctx, owner.ID, task.ID, member.ID); err != nil {
		t.Fatalf("ShareTask: %v", err)
	}
	if err := st.RespondToShare(ctx, member.ID, task.ID, true); err != nil {
		t.Fatalf("RespondToShare: %v", err)
	}

	s := NewServer(st, Options{})
	h := s.Handler()
	memberCookie := signIn(t, st, s.opts.SessionTTL, member)

	// The member can see it...
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/tasks/%d", task.ID), nil)
	req.AddCookie(memberCookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("member should see the shared task, got %d", rec.Code)
	}

	// ...but cannot reschedule or restructure it.
	until := time.Now().UTC().Add(24 * time.Hour).Format(time.RFC3339)
	for _, tc := range []struct{ path, body string }{
		{fmt.Sprintf("/api/tasks/%d/snooze", task.ID), fmt.Sprintf(`{"until":%q}`, until)},
		{fmt.Sprintf("/api/tasks/%d/skip", task.ID), ""},
		{fmt.Sprintf("/api/tasks/%d/pin", task.ID), `{"pinned":true}`},
		{fmt.Sprintf("/api/tasks/%d/duplicate", task.ID), ""},
	} {
		rec := post(t, h, tc.path, memberCookie, tc.body)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: expected 404 for a non-owner, got %d (%s)", tc.path, rec.Code, rec.Body.String())
		}
	}
}

// A per-task reminder lead is optional and must reject nonsense.
func TestReminderLeadOverrideRoundTrips(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	req := httptest.NewRequest(http.MethodPost, "/api/tasks",
		strings.NewReader(`{"name":"back up the NAS","intervalSeconds":604800,"reminderLeadSeconds":86400}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: got %d, body %s", rec.Code, rec.Body.String())
	}
	task := decodeTask(t, rec)
	if task.ReminderLeadSeconds == nil || *task.ReminderLeadSeconds != 86400 {
		t.Fatalf("reminderLeadSeconds = %v, want 86400", task.ReminderLeadSeconds)
	}

	// Null clears it back to the account default.
	req = httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/api/tasks/%d", task.ID),
		strings.NewReader(`{"name":"back up the NAS","intervalSeconds":604800,"reminderLeadSeconds":null}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: got %d", rec.Code)
	}
	if decodeTask(t, rec).ReminderLeadSeconds != nil {
		t.Error("expected the override to be cleared")
	}

	// A negative lead would fire after the due time, which isn't a reminder.
	req = httptest.NewRequest(http.MethodPost, "/api/tasks",
		strings.NewReader(`{"name":"bad","reminderLeadSeconds":-60}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for a negative lead, got %d", rec.Code)
	}
}
