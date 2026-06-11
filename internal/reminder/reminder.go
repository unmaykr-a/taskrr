// Package reminder evaluates per-user cadence reminders and delivers them as
// outbound webhooks. A single goroutine ticks on an interval; for each due task
// whose owner has reminders enabled, it POSTs a JSON payload to the user's
// configured URL exactly once per due cycle (a cycle advances each time the task
// is completed). The payload carries several common keys (title/message/content)
// so it works as-is with ntfy, Apprise, Gotify, Discord, Home Assistant, etc.
//
// SSRF: the webhook URL is user-supplied, so deliveries are constrained. The
// scheme must be http/https, and the client refuses (at dial time, on the
// resolved IP) to connect to loopback, link-local / cloud-metadata, multicast,
// or the unspecified address, and won't follow redirects. RFC-1918 private/LAN
// addresses are allowed on purpose — reaching a local ntfy or Home Assistant is
// the feature, and accounts are admin-created.
package reminder

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// Store is the slice of the data layer the reminder loop needs.
type Store interface {
	ListReminderCandidates(ctx context.Context) ([]store.ReminderCandidate, error)
	MarkReminded(ctx context.Context, taskID int64, dueAt time.Time) error
}

// Service evaluates and delivers reminders.
type Service struct {
	store  Store
	client *http.Client
}

// New builds a Service whose HTTP client refuses to connect to the server's own
// loopback, link-local / cloud-metadata, and other non-routable addresses.
func New(st Store) *Service {
	return &Service{store: st, client: newHTTPClient(blockInternalIP)}
}

// blockInternalIP reports whether an address must never be a webhook target:
// loopback (the server's own internal ports), link-local incl. 169.254.169.254
// cloud metadata, multicast, and the unspecified address. RFC-1918 private LAN
// ranges are intentionally allowed — reaching a local ntfy / Home Assistant is
// the feature. The check runs at dial time on the *resolved* IP, so a hostname
// that resolves (or redirects/rebinds) to a blocked IP is still refused.
func blockInternalIP(ip net.IP) bool {
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified()
}

// newHTTPClient builds a webhook client: a 10s timeout, no redirect-following
// (so a public URL can't bounce to an internal one), and a dial-time guard that
// rejects connections to addresses `blocked` returns true for.
func newHTTPClient(blocked func(net.IP) bool) *http.Client {
	dialer := &net.Dialer{
		Timeout: 5 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip == nil {
				return fmt.Errorf("unresolvable webhook address %q", address)
			}
			if blocked(ip) {
				return fmt.Errorf("webhook target %s is not allowed", ip)
			}
			return nil
		},
	}
	return &http.Client{
		Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("redirects are not allowed for webhooks")
		},
		Transport: &http.Transport{DialContext: dialer.DialContext},
	}
}

// Run ticks every interval (and once immediately) until ctx is cancelled.
func (s *Service) Run(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	s.Tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.Tick(ctx)
		}
	}
}

// Tick evaluates all candidates once and delivers any that are due and not yet
// reminded for their current cycle. A failed delivery is logged and left
// un-marked, so it retries on the next tick.
func (s *Service) Tick(ctx context.Context) {
	now := time.Now().UTC()
	cands, err := s.store.ListReminderCandidates(ctx)
	if err != nil {
		log.Printf("reminder: list candidates: %v", err)
		return
	}
	for _, c := range cands {
		due := c.LastCompleted.Add(time.Duration(c.IntervalSecs) * time.Second)
		fireAt := due.Add(-time.Duration(c.LeadSeconds) * time.Second)
		if now.Before(fireAt) {
			continue // not due yet
		}
		if c.LastRemindedDue == due.UTC().Format(time.RFC3339) {
			continue // already reminded for this cycle
		}
		if err := s.send(ctx, c.WebhookURL, reminderPayload(c.TaskName, c.TaskID, due, now)); err != nil {
			log.Printf("reminder: task %d webhook failed: %v", c.TaskID, err)
			continue // leave un-marked so it retries next tick
		}
		if err := s.store.MarkReminded(ctx, c.TaskID, due); err != nil {
			log.Printf("reminder: mark task %d reminded: %v", c.TaskID, err)
		}
	}
}

// SendTest posts a sample payload to a URL so a user can verify their webhook.
func (s *Service) SendTest(ctx context.Context, rawURL string) error {
	return s.send(ctx, rawURL, map[string]any{
		"title":   "Taskrr test",
		"message": "Your Taskrr reminders webhook is working.",
		"content": "Your Taskrr reminders webhook is working.",
		"test":    true,
	})
}

// SendTest posts a sample payload using the same guarded client as the loop (for
// callers without a Service, e.g. the API handler).
func SendTest(ctx context.Context, rawURL string) error {
	return (&Service{client: newHTTPClient(blockInternalIP)}).SendTest(ctx, rawURL)
}

func reminderPayload(name string, id int64, due, now time.Time) map[string]any {
	var msg string
	if d := now.Sub(due); d >= 0 {
		msg = fmt.Sprintf("%q is due (overdue by %s).", name, humanizeDur(d))
	} else {
		msg = fmt.Sprintf("%q is due in %s.", name, humanizeDur(-d))
	}
	return map[string]any{
		"title":   "Taskrr reminder",
		"message": msg,
		"content": msg, // Discord-compatible key
		"task":    name,
		"taskId":  id,
		"dueAt":   due.UTC().Format(time.RFC3339),
	}
}

func (s *Service) send(ctx context.Context, rawURL string, payload map[string]any) error {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("invalid webhook url")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "taskrr")
	resp, err := s.client.Do(req)
	if err != nil {
		// Strip the URL from the error: webhook URLs are returned only to their
		// owner by the API, but delivery failures are logged where any admin can
		// read them (Admin → Logs). Keep the operation + underlying cause.
		var ue *url.Error
		if errors.As(err, &ue) {
			return fmt.Errorf("webhook %s failed: %w", ue.Op, ue.Err)
		}
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// humanizeDur renders a duration compactly: "3d", "5h", "20m", "<1m".
func humanizeDur(d time.Duration) string {
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	case d >= time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	case d >= time.Minute:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	default:
		return "<1m"
	}
}
