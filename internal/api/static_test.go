package api

import "testing"

// TestCacheControl pins the caching policy for the embedded SPA: hashed assets
// are immutable, index.html always revalidates (deploys show up immediately),
// everything else gets a short cache.
func TestCacheControl(t *testing.T) {
	cases := []struct{ path, want string }{
		{"assets/index-Bx1Z2abc.js", "public, max-age=31536000, immutable"},
		{"assets/index-Cc3D4def.css", "public, max-age=31536000, immutable"},
		{"index.html", "no-cache"},
		{"favicon.svg", "public, max-age=3600"},
	}
	for _, c := range cases {
		if got := cacheControl(c.path); got != c.want {
			t.Errorf("cacheControl(%q) = %q, want %q", c.path, got, c.want)
		}
	}
}
