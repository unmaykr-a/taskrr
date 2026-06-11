package reminder

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// testService allows loopback so Tick logic can be exercised against an httptest
// server (which binds to 127.0.0.1); the real client blocks loopback.
func testService(st Store) *Service {
	return &Service{store: st, client: newHTTPClient(func(net.IP) bool { return false })}
}

// fakeStore is an in-memory Store for exercising Tick without a database.
type fakeStore struct {
	cands  []store.ReminderCandidate
	marked map[int64]time.Time
}

func (f *fakeStore) ListReminderCandidates(context.Context) ([]store.ReminderCandidate, error) {
	out := make([]store.ReminderCandidate, len(f.cands))
	copy(out, f.cands)
	for i := range out {
		if due, ok := f.marked[out[i].TaskID]; ok {
			out[i].LastRemindedDue = due.UTC().Format(time.RFC3339)
		}
	}
	return out, nil
}

func (f *fakeStore) MarkReminded(_ context.Context, taskID int64, dueAt time.Time) error {
	if f.marked == nil {
		f.marked = map[int64]time.Time{}
	}
	f.marked[taskID] = dueAt
	return nil
}

func countingServer(hits *int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(hits, 1)
		w.WriteHeader(http.StatusOK)
	}))
}

func TestTickSendsOncePerCycle(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	// Completed 2h ago, 1h cadence, no lead → overdue → should fire once.
	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 1, OwnerID: 1, TaskName: "Water plants", IntervalSecs: 3600,
		WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-2 * time.Hour).UTC(),
	}}}
	s := testService(fs)
	s.Tick(context.Background())
	s.Tick(context.Background()) // same cycle → deduped
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected exactly 1 webhook, got %d", got)
	}
}

func TestTickSkipsNotDue(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	// Completed 10m ago, 1h cadence, no lead → not due yet.
	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 2, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-10 * time.Minute).UTC(),
	}}}
	testService(fs).Tick(context.Background())
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("did not expect a webhook for a not-due task, got %d", got)
	}
}

func TestTickHonoursLeadTime(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	// Completed 50m ago, 1h cadence (due in 10m), 1h lead → fires now.
	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 3, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 3600,
		LastCompleted: time.Now().Add(-50 * time.Minute).UTC(),
	}}}
	testService(fs).Tick(context.Background())
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected a lead-time webhook, got %d", got)
	}
}

func TestBlockInternalIP(t *testing.T) {
	blocked := []string{"127.0.0.1", "::1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "fe80::1"}
	for _, s := range blocked {
		if !blockInternalIP(net.ParseIP(s)) {
			t.Errorf("%s should be blocked", s)
		}
	}
	// Public and private-LAN addresses are allowed (LAN reach is the feature).
	allowed := []string{"8.8.8.8", "192.168.1.10", "10.0.0.5", "172.16.0.9"}
	for _, s := range allowed {
		if blockInternalIP(net.ParseIP(s)) {
			t.Errorf("%s should be allowed", s)
		}
	}
}

// TestSendRejectsLoopback drives the real (guarded) client against a loopback
// httptest server: the SSRF dial guard must refuse the connection, so the
// server is never hit even though the URL is syntactically valid.
func TestSendRejectsLoopback(t *testing.T) {
	var hits int32
	srv := countingServer(&hits) // binds to 127.0.0.1
	defer srv.Close()

	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 9, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-2 * time.Hour).UTC(),
	}}}
	New(fs).Tick(context.Background()) // real guard blocks the loopback dial
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("loopback webhook should have been blocked, but server was hit %d time(s)", got)
	}
	// A blocked delivery is not marked, so it isn't silently considered "done".
	if _, ok := fs.marked[9]; ok {
		t.Fatal("a blocked delivery must not be marked as reminded")
	}
}

func TestSendTestRejectsLoopback(t *testing.T) {
	if err := SendTest(context.Background(), "http://127.0.0.1:9/"); err == nil {
		t.Fatal("SendTest to loopback should fail")
	}
}
