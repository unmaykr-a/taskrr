package reminder

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
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

// markKey dedups reminders per (task, recipient), mirroring the real store.
type markKey struct {
	task int64
	user int64
}

// fakeStore is an in-memory Store for exercising Tick without a database.
type fakeStore struct {
	cands  []store.ReminderCandidate
	marked map[markKey]time.Time
}

func (f *fakeStore) ListReminderCandidates(context.Context) ([]store.ReminderCandidate, error) {
	out := make([]store.ReminderCandidate, len(f.cands))
	copy(out, f.cands)
	for i := range out {
		if due, ok := f.marked[markKey{out[i].TaskID, out[i].UserID}]; ok {
			out[i].LastRemindedDue = due.UTC().Format(time.RFC3339)
		}
	}
	return out, nil
}

func (f *fakeStore) MarkReminded(_ context.Context, taskID, userID int64, dueAt time.Time) error {
	if f.marked == nil {
		f.marked = map[markKey]time.Time{}
	}
	f.marked[markKey{taskID, userID}] = dueAt
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

// A snoozed task must go quiet. Snoozing is how someone says "not now"; a
// reminder arriving anyway is the exact thing the feature exists to stop.
func TestTickStaysQuietWhileSnoozed(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	// Overdue by an hour on its own, but snoozed for another two days.
	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 4, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-2 * time.Hour).UTC(),
		SnoozedUntil:  time.Now().Add(48 * time.Hour).UTC(),
	}}}
	testService(fs).Tick(context.Background())
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("a snoozed task must not send a reminder, got %d", got)
	}
}

// Once the snooze has run out the task is due again and should fire normally.
func TestTickFiresAgainOnceTheSnoozeHasPassed(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 5, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-5 * time.Hour).UTC(),
		SnoozedUntil:  time.Now().Add(-time.Minute).UTC(), // expired
	}}}
	testService(fs).Tick(context.Background())
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("expected a reminder once the snooze expired, got %d", got)
	}
}

// A snooze earlier than the natural due time must not drag the reminder forward.
func TestTickIgnoresASnoozeBeforeTheDueTime(t *testing.T) {
	var hits int32
	srv := countingServer(&hits)
	defer srv.Close()

	// Due in 50 minutes; a snooze 10 minutes out is irrelevant.
	fs := &fakeStore{cands: []store.ReminderCandidate{{
		TaskID: 6, IntervalSecs: 3600, WebhookURL: srv.URL, LeadSeconds: 0,
		LastCompleted: time.Now().Add(-10 * time.Minute).UTC(),
		SnoozedUntil:  time.Now().Add(10 * time.Minute).UTC(),
	}}}
	testService(fs).Tick(context.Background())
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("expected no reminder before the real due time, got %d", got)
	}
}

func TestBlockInternalIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1", "::1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "fe80::1",
		// The same addresses written the ways an IPv6 network can reach them:
		// v4-mapped, and through a NAT64 gateway's well-known prefix.
		"::ffff:127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe",
	}
	for _, s := range blocked {
		if !blockInternalIP(net.ParseIP(s)) {
			t.Errorf("%s should be blocked", s)
		}
	}
	// Public and private-LAN addresses are allowed (LAN reach is the feature).
	allowed := []string{"8.8.8.8", "192.168.1.10", "10.0.0.5", "172.16.0.9", "2606:4700::1111", "64:ff9b::808:808"}
	for _, s := range allowed {
		if blockInternalIP(net.ParseIP(s)) {
			t.Errorf("%s should be allowed", s)
		}
	}
}

// With the LAN closed off, a webhook can't be used to reach anything on the
// network the server sits in — including the halves of it the IPv4 checks miss.
func TestBlockerWithoutPrivateTargets(t *testing.T) {
	block := blocker(false)
	for _, s := range []string{
		"192.168.1.10", "10.0.0.5", "172.16.0.9", // RFC 1918
		"fd00::1", "fdff:ffff::abcd", // IPv6 unique-local
		"100.64.0.1", "100.127.255.254", // carrier-grade / Tailscale space
		"::ffff:192.168.1.10", "64:ff9b::c0a8:10a", // the same, v4-mapped and via NAT64
		"127.0.0.1", "169.254.169.254", // still blocked, as always
	} {
		if !block(net.ParseIP(s)) {
			t.Errorf("%s should be blocked when private targets are off", s)
		}
	}
	// The internet is still reachable — that is the point of a webhook.
	for _, s := range []string{"8.8.8.8", "1.1.1.1", "2606:4700::1111", "99.86.4.1", "100.128.0.1", "100.63.255.255"} {
		if block(net.ParseIP(s)) {
			t.Errorf("%s should still be allowed", s)
		}
	}
	// And the default keeps the LAN reachable.
	if blocker(true)(net.ParseIP("192.168.1.10")) {
		t.Error("192.168.1.10 should be reachable by default")
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
	New(fs, true).Tick(context.Background()) // real guard blocks the loopback dial
	if got := atomic.LoadInt32(&hits); got != 0 {
		t.Fatalf("loopback webhook should have been blocked, but server was hit %d time(s)", got)
	}
	// A blocked delivery is not marked, so it isn't silently considered "done".
	if _, ok := fs.marked[markKey{9, 0}]; ok {
		t.Fatal("a blocked delivery must not be marked as reminded")
	}
}

func TestSendTestRejectsLoopback(t *testing.T) {
	if err := SendTest(context.Background(), "http://127.0.0.1:9/", true); err == nil {
		t.Fatal("SendTest to loopback should fail")
	}
}

// The button that tests a webhook has to obey the same setting the loop does,
// or it reports success for a delivery that will never actually be made.
func TestSendTestHonoursThePrivateSetting(t *testing.T) {
	// Refused by the guard before a connection is attempted, so this costs
	// nothing — where hard-coding the old policy would let it dial out and hang
	// until the timeout, which is the failure this is here to catch.
	err := SendTest(context.Background(), "http://192.168.0.1:9/", false)
	if err == nil || !strings.Contains(err.Error(), "not allowed") {
		t.Fatalf("SendTest with private targets off = %v, want a refusal by the guard", err)
	}
}
