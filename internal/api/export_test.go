package api

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

func getWithCookie(t *testing.T, h http.Handler, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// seedExportFixture builds a user with one logged task and one never-done task,
// which is the combination the CSV shape has to handle.
func seedExportFixture(t *testing.T, st *store.Store, username string) (store.User, store.Task) {
	t.Helper()
	ctx := context.Background()
	u, err := st.CreateUser(ctx, store.UserInput{Username: username, Role: "user", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	every := int64(604800)
	task, err := st.CreateTask(ctx, u.ID, store.TaskInput{
		Name: "water plants", Description: "the big ones", Folder: "Home",
		Tags: []string{"home", "plants"}, IntervalSeconds: &every,
	})
	if err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	if _, err := st.AddCompletion(ctx, u.ID, task.ID, time.Now().UTC().Add(-48*time.Hour), "quick round"); err != nil {
		t.Fatalf("AddCompletion: %v", err)
	}
	if _, err := st.CreateTask(ctx, u.ID, store.TaskInput{Name: "descale kettle"}); err != nil {
		t.Fatalf("CreateTask: %v", err)
	}
	return u, task
}

func TestExportJSONIncludesTasksAndHistory(t *testing.T) {
	st := openStore(t)
	u, _ := seedExportFixture(t, st, "u")
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := getWithCookie(t, h, "/api/me/export", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("export: got %d, body %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("content-type = %q", ct)
	}
	// It's a download, not something to render in the tab.
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment") || !strings.Contains(cd, ".json") {
		t.Errorf("content-disposition = %q", cd)
	}

	var doc struct {
		Format string `json:"format"`
		Tasks  []struct {
			Name        string `json:"name"`
			Folder      string `json:"folder"`
			Completions []struct {
				Note string `json:"note"`
			} `json:"completions"`
		} `json:"tasks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if doc.Format != exportFormat {
		t.Errorf("format = %q, want %q", doc.Format, exportFormat)
	}
	if len(doc.Tasks) != 2 {
		t.Fatalf("expected 2 tasks, got %d", len(doc.Tasks))
	}
	var found bool
	for _, task := range doc.Tasks {
		if task.Name != "water plants" {
			continue
		}
		found = true
		if task.Folder != "Home" {
			t.Errorf("folder = %q", task.Folder)
		}
		if len(task.Completions) != 1 || task.Completions[0].Note != "quick round" {
			t.Errorf("history not carried through: %+v", task.Completions)
		}
	}
	if !found {
		t.Error("logged task missing from the export")
	}
}

func TestExportCSVKeepsNeverDoneTasks(t *testing.T) {
	st := openStore(t)
	u, _ := seedExportFixture(t, st, "u")
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	rec := getWithCookie(t, h, "/api/me/export?format=csv", cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("export csv: got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("content-type = %q", ct)
	}

	rows, err := csv.NewReader(strings.NewReader(rec.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	// header + one completion row + one never-done row
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d: %v", len(rows), rows)
	}
	if rows[0][0] != "task" || rows[0][6] != "completed_at" {
		t.Errorf("unexpected header: %v", rows[0])
	}
	var sawNeverDone bool
	for _, row := range rows[1:] {
		if row[0] == "descale kettle" {
			sawNeverDone = true
			if row[6] != "" || row[7] != "" {
				t.Errorf("never-done row should have empty completion columns: %v", row)
			}
		}
	}
	if !sawNeverDone {
		t.Error("a task with no history was dropped from the CSV")
	}
}

// TestExportIsOwnerScoped is the one that matters: an export must never be a
// side door onto somebody else's data.
func TestExportIsOwnerScoped(t *testing.T) {
	st := openStore(t)
	_, _ = seedExportFixture(t, st, "alice")
	bob, err := st.CreateUser(context.Background(), store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	s := NewServer(st, Options{})
	h := s.Handler()

	rec := getWithCookie(t, h, "/api/me/export", signIn(t, st, s.opts.SessionTTL, bob))
	if rec.Code != http.StatusOK {
		t.Fatalf("export: got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "water plants") {
		t.Fatal("bob's export leaked alice's tasks")
	}
	var doc struct {
		Username string `json:"username"`
		Tasks    []any  `json:"tasks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if doc.Username != "bob" || len(doc.Tasks) != 0 {
		t.Fatalf("expected an empty export for bob, got %+v", doc)
	}
}

func TestExportRequiresAuth(t *testing.T) {
	st := openStore(t)
	s := NewServer(st, Options{})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/me/export", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

// TestSanitizeFilename keeps an exotic username from breaking out of the
// Content-Disposition header it gets interpolated into.
func TestSanitizeFilename(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"alice", "alice"},
		{"Bob_99", "Bob_99"},
		{`a"; rm -rf /`, "a-rm-rf"},
		{"../../etc/passwd", "etc-passwd"},
		{"文字", "export"},
		{"", "export"},
		{strings.Repeat("x", 100), strings.Repeat("x", 40)},
	} {
		if got := sanitizeFilename(tc.in); got != tc.want {
			t.Errorf("sanitizeFilename(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestExportCSVDefusesFormulas: a task name is not always your own — a task
// shared with you carries the name its owner chose — so a cell that a
// spreadsheet would execute has to be neutralised on the way out.
func TestExportCSVDefusesFormulas(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   string
		want string
	}{
		{"equals", `=HYPERLINK("http://evil","invoice")`, `'=HYPERLINK("http://evil","invoice")`},
		{"plus", "+1+1", "'+1+1"},
		{"minus", "-2+3", "'-2+3"},
		{"at", "@SUM(A1:A9)", "'@SUM(A1:A9)"},
		{"tab", "\tcmd", "'\tcmd"},
		{"carriage return", "\r=1", "'\r=1"},
		{"ordinary name", "Water the plants", "Water the plants"},
		{"empty", "", ""},
		{"equals not at the start", "2 = 2", "2 = 2"},
	} {
		if got := csvCell(tc.in); got != tc.want {
			t.Errorf("%s: csvCell(%q) = %q, want %q", tc.name, tc.in, got, tc.want)
		}
	}
}

// TestExportCSVFormulaEndToEnd: the defusal is actually wired into the export,
// not just available as a helper.
func TestExportCSVFormulaEndToEnd(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "csvuser", PasswordHash: ptr("h")})
	s := NewServer(st, Options{ProtectedUserID: u.ID})

	payload := `=HYPERLINK("http://evil","x")`
	task, err := st.CreateTask(ctx, u.ID, store.TaskInput{Name: payload, Description: "@danger", Folder: "-Home"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := st.AddCompletion(ctx, task.ID, u.ID, time.Now(), "+note"); err != nil {
		t.Fatalf("complete: %v", err)
	}

	w := httptest.NewRecorder()
	req := authed("GET", "", u)
	q := req.URL.Query()
	q.Set("format", "csv")
	req.URL.RawQuery = q.Encode()
	s.handleExport(w, req)
	if w.Code != 200 {
		t.Fatalf("csv export = %d, want 200", w.Code)
	}
	csvBody := w.Body.String()
	for _, live := range []string{"\"" + payload, ",@danger", ",-Home", ",+note"} {
		if strings.Contains(csvBody, live) {
			t.Errorf("csv still contains an executable cell %q:\n%s", live, csvBody)
		}
	}
	for _, defused := range []string{"'=HYPERLINK", "'@danger", "'-Home", "'+note"} {
		if !strings.Contains(csvBody, defused) {
			t.Errorf("csv missing the defused form %q:\n%s", defused, csvBody)
		}
	}
}
