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
	MarkReminded(ctx context.Context, taskID, userID int64, dueAt time.Time) error
}

// Service evaluates and delivers reminders.
type Service struct {
	store  Store
	client *http.Client
}

// New builds a Service whose HTTP client refuses to connect to the server's own
// loopback, link-local / cloud-metadata, and other non-routable addresses.
//
// allowPrivate decides the one range that is a judgement call rather than a
// rule. Reaching a local ntfy or Home Assistant is why webhooks exist here, so
// the LAN is reachable by default — but on an instance where the accounts
// aren't all trusted, a webhook is a way to ask the server to make requests
// into a network the person holding the account can't reach themselves. Setting
// it false closes the whole private side of the network to webhooks.
func New(st Store, allowPrivate bool) *Service {
	return &Service{store: st, client: newHTTPClient(blocker(allowPrivate))}
}

// blocker returns the dial-time predicate for this instance's setting.
func blocker(allowPrivate bool) func(net.IP) bool {
	if allowPrivate {
		return blockInternalIP
	}
	return func(ip net.IP) bool { return blockInternalIP(ip) || isPrivateIP(ip) }
}

// blockInternalIP reports whether an address must never be a webhook target
// whatever the settings say: loopback (the server's own internal ports),
// link-local incl. the 169.254.169.254 cloud metadata service, multicast, and
// the unspecified address. The check runs at dial time on the *resolved* IP, so
// a hostname that resolves (or rebinds) to a blocked IP is still refused.
func blockInternalIP(ip net.IP) bool {
	ip = unwrapNAT64(ip)
	return ip.IsLoopback() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified()
}

// isPrivateIP covers the ranges that are someone's own network rather than the
// internet: RFC 1918, IPv6 unique-local (fc00::/7, which net.IP.IsPrivate
// reports), and the 100.64.0.0/10 shared space that Tailscale and ISP-side NAT
// use.
func isPrivateIP(ip net.IP) bool {
	ip = unwrapNAT64(ip)
	if ip.IsPrivate() {
		return true
	}
	v4 := ip.To4()
	return v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
}

// nat64Prefix is 64:ff9b::/96, the well-known prefix an IPv6-only network uses
// to address the IPv4 internet through a translating gateway.
var nat64Prefix = []byte{0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0}

// unwrapNAT64 returns the IPv4 address embedded in a NAT64 address, or the
// address unchanged. Without this the checks above read 64:ff9b::a9fe:a9fe as
// an ordinary public IPv6 address and let it through — while the gateway
// dutifully translates it to 169.254.169.254.
//
// (The IPv4-mapped form, ::ffff:10.0.0.1, needs no such help: To4 already
// resolves it, so every predicate here sees the IPv4 address.)
func unwrapNAT64(ip net.IP) net.IP {
	v6 := ip.To16()
	if v6 == nil || ip.To4() != nil {
		return ip
	}
	if !bytes.Equal(v6[:12], nat64Prefix) {
		return ip
	}
	return net.IP(v6[12:16])
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
		// A snooze pushes the effective due time out, so a task someone has
		// deliberately put off doesn't keep nagging them — the whole point of
		// snoozing. Skipping a cycle lands here the same way.
		if !c.SnoozedUntil.IsZero() && c.SnoozedUntil.After(due) {
			due = c.SnoozedUntil
		}
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
		if err := s.store.MarkReminded(ctx, c.TaskID, c.UserID, due); err != nil {
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
//
// allowPrivate has to be passed in and match what the loop was built with: a
// "test webhook" button that can reach addresses a real reminder can't would
// tell people their webhook works when it never will — and would make the
// setting a way to reach the LAN rather than a way to close it off.
func SendTest(ctx context.Context, rawURL string, allowPrivate bool) error {
	return (&Service{client: newHTTPClient(blocker(allowPrivate))}).SendTest(ctx, rawURL)
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
