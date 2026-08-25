package api

import (
	"net"
	"net/http"
	"strings"
)

// Reverse-proxy headers.
//
// Behind nginx, Caddy, Traefik or Cloudflare, the socket the request arrives on
// belongs to the proxy, not the person: the real client IP is in a header. That
// IP is what the per-IP login limiter counts and what the access log records, so
// reading the header is not cosmetic — and neither is believing it when nobody
// put it there. A header is written by whoever sent the request, so an instance
// reachable directly from the internet that trusts X-Forwarded-For lets any
// caller invent an address per attempt and step around the limiter entirely.
//
// So the question isn't whether to trust the headers but who from. The default
// answers it by looking at where the connection actually came from: a proxy sits
// next to the app (a loopback address, a container network, the LAN), while an
// attacker spoofing headers is reaching the app from somewhere else. That covers
// the two common deployments — proxy on the same host or bridge network, and app
// published straight to the internet — without either having to be configured.

// ProxyTrust says when the reverse-proxy headers may be believed.
type ProxyTrust string

const (
	// ProxyTrustAuto believes them only when the connection came from a loopback,
	// private, link-local or carrier-NAT address — the places a reverse proxy
	// lives. The default, and the right answer for nearly every deployment.
	ProxyTrustAuto ProxyTrust = "auto"
	// ProxyTrustAlways believes them whatever the peer address. Needed when the
	// proxy reaches the app from a public address (a hosted load balancer), and
	// unsafe if anything else can reach the app directly.
	ProxyTrustAlways ProxyTrust = "always"
	// ProxyTrustNever ignores them and always uses the socket address.
	ProxyTrustNever ProxyTrust = "never"
)

// ParseProxyTrust reads the operator's setting, accepting the booleans the
// option used to take ("true" meant always, "false" never) so an existing
// TASKRR_TRUST_PROXY_HEADERS keeps doing what it did. Anything unrecognised —
// including empty — is auto.
func ParseProxyTrust(v string) ProxyTrust {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on", "always":
		return ProxyTrustAlways
	case "0", "false", "no", "off", "never":
		return ProxyTrustNever
	default:
		return ProxyTrustAuto
	}
}

// trustsProxyHeaders reports whether this request's forwarding headers may be
// used.
func (s *Server) trustsProxyHeaders(r *http.Request) bool {
	switch s.opts.TrustProxyHeaders {
	case ProxyTrustAlways:
		return true
	case ProxyTrustNever:
		return false
	default:
		return trustedPeer(r.RemoteAddr)
	}
}

// trustedPeer reports whether an address is somewhere a reverse proxy plausibly
// runs: loopback, an RFC-1918 or IPv6 unique-local network, a link-local address
// or carrier-grade NAT space.
//
// An address that doesn't parse counts as trusted: that's a Unix socket, which
// is as local as it gets.
func trustedPeer(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	if ip == nil {
		return true
	}
	return ip.IsLoopback() ||
		ip.IsPrivate() || // RFC 1918 and IPv6 unique-local (fc00::/7)
		ip.IsLinkLocalUnicast() ||
		isCarrierNAT(ip)
}

// isCarrierNAT reports whether an address is in 100.64.0.0/10 — shared address
// space, which is where Tailscale and a good many ISP-side networks put hosts.
func isCarrierNAT(ip net.IP) bool {
	v4 := ip.To4()
	return v4 != nil && v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127
}
