package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRateLimiterAllowsUpToMax(t *testing.T) {
	rl := newRateLimiter(2, time.Minute)
	if !rl.allow("k") || !rl.allow("k") {
		t.Fatal("first two attempts should be allowed")
	}
	if rl.allow("k") {
		t.Fatal("third attempt should be blocked")
	}
	// A different key has its own independent budget.
	if !rl.allow("other") {
		t.Fatal("a different key should not be affected")
	}
}

func TestRateLimiterWindowExpiry(t *testing.T) {
	rl := newRateLimiter(1, 20*time.Millisecond)
	if !rl.allow("k") {
		t.Fatal("first attempt should be allowed")
	}
	if rl.allow("k") {
		t.Fatal("second attempt within the window should be blocked")
	}
	time.Sleep(30 * time.Millisecond)
	if !rl.allow("k") {
		t.Fatal("attempt after the window should be allowed again")
	}
}

func TestRateLimiterNilSafe(t *testing.T) {
	var rl *rateLimiter
	if !rl.allow("k") {
		t.Fatal("a nil limiter should allow (fail open)")
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name    string
		trust   bool
		headers map[string]string
		remote  string
		want    string
	}{
		{"cf-connecting-ip wins", true, map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "10.0.0.1:5555", "1.2.3.4"},
		{"xff leftmost", true, map[string]string{"X-Forwarded-For": "9.9.9.9, 10.0.0.1"}, "10.0.0.1:5555", "9.9.9.9"},
		{"xff single", true, map[string]string{"X-Forwarded-For": "8.8.8.8"}, "10.0.0.1:5555", "8.8.8.8"},
		{"remoteaddr fallback", true, nil, "172.16.0.9:4444", "172.16.0.9"},
		// With proxy headers untrusted, a spoofed header can't move the IP.
		{"untrusted ignores cf header", false, map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "10.0.0.1:5555", "10.0.0.1"},
		{"untrusted ignores xff", false, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "10.0.0.1:5555", "10.0.0.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := &Server{opts: Options{TrustProxyHeaders: c.trust}}
			r := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
			r.RemoteAddr = c.remote
			for k, v := range c.headers {
				r.Header.Set(k, v)
			}
			if got := s.clientIP(r); got != c.want {
				t.Fatalf("clientIP = %q, want %q", got, c.want)
			}
		})
	}
}

func TestRateLimiterSweepDropsIdleKeys(t *testing.T) {
	rl := newRateLimiter(3, 20*time.Millisecond)
	rl.allow("stale-1")
	rl.allow("stale-2")
	time.Sleep(30 * time.Millisecond) // both windows fully aged out
	rl.allow("fresh")                 // first touch after a full window triggers the sweep
	rl.mu.Lock()
	defer rl.mu.Unlock()
	if _, ok := rl.hits["stale-1"]; ok {
		t.Fatal("aged-out key should have been swept")
	}
	if _, ok := rl.hits["stale-2"]; ok {
		t.Fatal("aged-out key should have been swept")
	}
	if _, ok := rl.hits["fresh"]; !ok {
		t.Fatal("the live key must survive the sweep")
	}
}
