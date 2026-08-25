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
		trust   ProxyTrust
		headers map[string]string
		remote  string
		want    string
	}{
		{"cf-connecting-ip wins", ProxyTrustAlways, map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "10.0.0.1:5555", "1.2.3.4"},
		{"xff leftmost", ProxyTrustAlways, map[string]string{"X-Forwarded-For": "9.9.9.9, 10.0.0.1"}, "10.0.0.1:5555", "9.9.9.9"},
		{"xff single", ProxyTrustAlways, map[string]string{"X-Forwarded-For": "8.8.8.8"}, "10.0.0.1:5555", "8.8.8.8"},
		{"remoteaddr fallback", ProxyTrustAlways, nil, "172.16.0.9:4444", "172.16.0.9"},
		// With proxy headers untrusted, a spoofed header can't move the IP.
		{"untrusted ignores cf header", ProxyTrustNever, map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "10.0.0.1:5555", "10.0.0.1"},
		{"untrusted ignores xff", ProxyTrustNever, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "10.0.0.1:5555", "10.0.0.1"},
		{"never ignores a loopback proxy too", ProxyTrustNever, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "127.0.0.1:5555", "127.0.0.1"},
		// Auto is the default, and decides by who is connecting: a proxy next to
		// the app is believed, a stranger on the internet is not.
		{"auto believes a loopback proxy", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "127.0.0.1:5555", "9.9.9.9"},
		{"auto believes a docker-network proxy", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "172.18.0.2:5555", "9.9.9.9"},
		{"auto believes an IPv6 loopback proxy", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "[::1]:5555", "9.9.9.9"},
		{"auto believes a unique-local proxy", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "[fd00::2]:5555", "9.9.9.9"},
		{"auto believes a tailscale peer", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "100.101.102.103:5555", "9.9.9.9"},
		{"auto refuses a public peer", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "203.0.113.7:5555", "203.0.113.7"},
		{"auto refuses a public peer's cf header", ProxyTrustAuto, map[string]string{"CF-Connecting-IP": "1.2.3.4"}, "203.0.113.7:5555", "203.0.113.7"},
		{"auto refuses a public IPv6 peer", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "[2001:db8::5]:5555", "2001:db8::5"},
		{"auto trusts a unix socket", ProxyTrustAuto, map[string]string{"X-Forwarded-For": "9.9.9.9"}, "@", "9.9.9.9"},
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

// The option used to be a plain boolean, and an operator who set it stays set.
func TestParseProxyTrust(t *testing.T) {
	cases := map[string]ProxyTrust{
		"":         ProxyTrustAuto,
		"auto":     ProxyTrustAuto,
		"true":     ProxyTrustAlways,
		"1":        ProxyTrustAlways,
		"on":       ProxyTrustAlways,
		" Always":  ProxyTrustAlways,
		"false":    ProxyTrustNever,
		"0":        ProxyTrustNever,
		"off":      ProxyTrustNever,
		"NEVER":    ProxyTrustNever,
		"nonsense": ProxyTrustAuto,
	}
	for in, want := range cases {
		if got := ParseProxyTrust(in); got != want {
			t.Errorf("ParseProxyTrust(%q) = %q, want %q", in, got, want)
		}
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
