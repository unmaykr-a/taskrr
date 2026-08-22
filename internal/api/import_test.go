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

func postImport(t *testing.T, h http.Handler, cookie *http.Cookie, mode, body string) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/me/import"
	if mode != "" {
		path += "?mode=" + mode
	}
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeImportResult(t *testing.T, rec *httptest.ResponseRecorder) importResult {
	t.Helper()
	var out importResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode result: %v (body %s)", err, rec.Body.String())
	}
	return out
}

const sampleImport = `{
  "format": "taskrr-export-v1",
  "tasks": [
    {
      "name": "water plants", "description": "the big ones", "folder": "Home",
      "tags": ["home", "plants"], "intervalSeconds": 604800, "pinned": true,
      "completions": [
        {"completedAt": "2026-06-01T10:00:00Z", "note": "quick round"},
        {"completedAt": "2026-06-08T10:00:00Z", "note": ""}
      ]
    },
    {"name": "descale kettle", "completions": []}
  ]
}`

func TestImportRestoresTasksAndHistory(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := postImport(t, h, cookie, "", sampleImport)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeImportResult(t, rec)
	if got.TasksCreated != 2 || got.CompletionsAdded != 2 {
		t.Fatalf("result = %+v, want 2 tasks / 2 completions", got)
	}
	if len(got.Skipped) != 0 {
		t.Errorf("unexpected skips: %v", got.Skipped)
	}

	tasks, err := st.ListTasks(ctx, u.ID)
	if err != nil {
		t.Fatalf("ListTasks: %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(tasks))
	}
	var plants store.Task
	for _, task := range tasks {
		if task.Name == "water plants" {
			plants = task
		}
	}
	if plants.ID == 0 {
		t.Fatal("imported task missing")
	}
	if plants.Description != "the big ones" || plants.Folder != "Home" || len(plants.Tags) != 2 {
		t.Errorf("definition not restored: %+v", plants)
	}
	if plants.IntervalSeconds == nil || *plants.IntervalSeconds != 604800 {
		t.Error("routine not restored")
	}
	if !plants.Pinned {
		t.Error("pinned flag not restored")
	}
	if plants.CompletionCount != 2 {
		t.Errorf("completionCount = %d, want 2", plants.CompletionCount)
	}
	completions, _ := st.ListCompletions(ctx, u.ID, plants.ID)
	if len(completions) != 2 {
		t.Fatalf("expected 2 completions, got %d", len(completions))
	}
	// Newest first, and the note came along.
	if !completions[0].CompletedAt.Equal(time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("completion timestamp = %v", completions[0].CompletedAt)
	}
	if completions[1].Note != "quick round" {
		t.Errorf("note = %q", completions[1].Note)
	}
}

// An export should survive a round trip through import unchanged in substance.
func TestExportImportRoundTrip(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	alice, _ := seedExportFixture(t, st, "alice")
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()

	exported := getWithCookie(t, h, "/api/me/export", signIn(t, st, s.opts.SessionTTL, alice))
	if exported.Code != http.StatusOK {
		t.Fatalf("export: got %d", exported.Code)
	}

	rec := postImport(t, h, signIn(t, st, s.opts.SessionTTL, bob), "", exported.Body.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeImportResult(t, rec)
	if got.TasksCreated != 2 || got.CompletionsAdded != 1 {
		t.Fatalf("round trip = %+v, want 2 tasks / 1 completion", got)
	}

	bobTasks, _ := st.ListTasks(ctx, bob.ID)
	if len(bobTasks) != 2 {
		t.Fatalf("bob should have 2 tasks, got %d", len(bobTasks))
	}
	// Crucially, they belong to bob now — the file said nothing that could change that.
	for _, task := range bobTasks {
		if task.OwnerID != bob.ID {
			t.Errorf("imported task is owned by %d, want %d", task.OwnerID, bob.ID)
		}
	}
	// And alice still has hers.
	aliceTasks, _ := st.ListTasks(ctx, alice.ID)
	if len(aliceTasks) != 2 {
		t.Errorf("alice's tasks were disturbed: %d", len(aliceTasks))
	}
}

// The file must not be able to claim an owner or an id.
func TestImportIgnoresOwnershipInTheFile(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()

	hostile := fmt.Sprintf(`{"format":%q,"tasks":[
		{"id": 999, "ownerId": %d, "name": "not yours", "completions": []}
	]}`, exportFormat, alice.ID)

	rec := postImport(t, h, signIn(t, st, s.opts.SessionTTL, bob), "", hostile)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}
	if n, _ := st.ListTasks(ctx, alice.ID); len(n) != 0 {
		t.Fatalf("the import landed in alice's account: %d task(s)", len(n))
	}
	bobTasks, _ := st.ListTasks(ctx, bob.ID)
	if len(bobTasks) != 1 || bobTasks[0].OwnerID != bob.ID {
		t.Fatalf("expected exactly one task owned by bob, got %+v", bobTasks)
	}
	if bobTasks[0].ID == 999 {
		t.Error("the file's id was honoured")
	}
}

func TestImportReplaceClearsFirst(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, existing := seedExportFixture(t, st, "u")
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := postImport(t, h, cookie, "replace", sampleImport)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeImportResult(t, rec)
	if got.TasksDeleted != 2 {
		t.Errorf("tasksDeleted = %d, want 2", got.TasksDeleted)
	}
	tasks, _ := st.ListTasks(ctx, u.ID)
	if len(tasks) != 2 {
		t.Fatalf("expected only the imported tasks, got %d", len(tasks))
	}
	for _, task := range tasks {
		if task.ID == existing.ID {
			t.Error("a pre-existing task survived a replace import")
		}
	}
}

func TestImportMergeKeepsWhatIsThere(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := seedExportFixture(t, st, "u")
	s := NewServer(st, Options{})
	h := s.Handler()

	rec := postImport(t, h, signIn(t, st, s.opts.SessionTTL, u), "merge", sampleImport)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d", rec.Code)
	}
	if got := decodeImportResult(t, rec); got.TasksDeleted != 0 {
		t.Errorf("merge deleted %d tasks", got.TasksDeleted)
	}
	tasks, _ := st.ListTasks(ctx, u.ID)
	if len(tasks) != 4 { // 2 seeded + 2 imported
		t.Fatalf("expected 4 tasks after a merge, got %d", len(tasks))
	}
}

func TestImportRejectsBadDocuments(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	for name, body := range map[string]string{
		"wrong format":   `{"format":"someone-elses-app","tasks":[{"name":"x"}]}`,
		"missing format": `{"tasks":[{"name":"x"}]}`,
		"no tasks":       fmt.Sprintf(`{"format":%q,"tasks":[]}`, exportFormat),
		"not json":       `this is not json`,
	} {
		t.Run(name, func(t *testing.T) {
			if rec := postImport(t, h, cookie, "", body); rec.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %d (%s)", rec.Code, rec.Body.String())
			}
		})
	}

	t.Run("unknown mode", func(t *testing.T) {
		if rec := postImport(t, h, cookie, "obliterate", sampleImport); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
	})
}

// A bad task inside an otherwise good file should be reported, not abort the
// whole import — and definitely not be written anyway.
func TestImportSkipsInvalidTasksAndSaysSo(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()

	body := fmt.Sprintf(`{"format":%q,"tasks":[
		{"name":"good one","completions":[]},
		{"name":"   ","completions":[]},
		{"name":"bad colour","colorFresh":"not-a-colour","completions":[]},
		{"name":"also good","completions":[]}
	]}`, exportFormat)

	rec := postImport(t, h, signIn(t, st, s.opts.SessionTTL, u), "", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}
	got := decodeImportResult(t, rec)
	if got.TasksCreated != 2 {
		t.Errorf("tasksCreated = %d, want 2", got.TasksCreated)
	}
	if len(got.Skipped) != 2 {
		t.Fatalf("expected 2 skip messages, got %v", got.Skipped)
	}
	tasks, _ := st.ListTasks(ctx, u.ID)
	for _, task := range tasks {
		if strings.TrimSpace(task.Name) == "" || task.Name == "bad colour" {
			t.Errorf("an invalid task was written anyway: %+v", task)
		}
	}
}

func TestImportRequiresAuth(t *testing.T) {
	st := openStore(t)
	s := NewServer(st, Options{})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/me/import", strings.NewReader(sampleImport))
	req.Header.Set("Content-Type", "application/json")
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// Import writes data, so it must not be reachable with an automation token.
func TestImportIsNotReachableByAPIToken(t *testing.T) {
	st := openStore(t)
	u, _ := st.CreateUser(context.Background(), store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)
	token, _ := mintToken(t, h, cookie, "automation")

	rec := bearer(t, h, http.MethodPost, "/api/me/import", token, sampleImport)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a token, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// A restore should keep scheduling intent that is still meaningful, and quietly
// drop the part that isn't.
func TestImportRestoresLiveSnoozeButNotAnExpiredOne(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()

	future := time.Now().UTC().Add(72 * time.Hour).Truncate(time.Second)
	past := time.Now().UTC().Add(-72 * time.Hour)
	body := fmt.Sprintf(`{"format":%q,"tasks":[
		{"name":"still snoozed","snoozedUntil":%q,"reminderLeadSeconds":86400,"completions":[]},
		{"name":"snooze expired","snoozedUntil":%q,"completions":[]}
	]}`, exportFormat, future.Format(time.RFC3339), past.Format(time.RFC3339))

	rec := postImport(t, h, signIn(t, st, s.opts.SessionTTL, u), "", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: got %d, body %s", rec.Code, rec.Body.String())
	}

	tasks, _ := st.ListTasks(ctx, u.ID)
	byName := map[string]store.Task{}
	for _, task := range tasks {
		byName[task.Name] = task
	}

	live := byName["still snoozed"]
	if live.SnoozedUntil == nil || !live.SnoozedUntil.Equal(future) {
		t.Errorf("a live snooze was not restored: %v", live.SnoozedUntil)
	}
	if live.ReminderLeadSeconds == nil || *live.ReminderLeadSeconds != 86400 {
		t.Errorf("the per-task reminder lead was not restored: %v", live.ReminderLeadSeconds)
	}
	if expired := byName["snooze expired"]; expired.SnoozedUntil != nil {
		t.Errorf("an expired snooze was restored: %v", expired.SnoozedUntil)
	}
}
