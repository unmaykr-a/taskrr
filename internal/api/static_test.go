package api

import (
	"mime"
	"testing"
)

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

// The manifest is what a phone reads to decide the name and icon it installs
// under, and it is served from the embedded bundle by extension alone.
func TestManifestContentType(t *testing.T) {
	got, _, err := mime.ParseMediaType(mime.TypeByExtension(".webmanifest"))
	if err != nil {
		t.Fatalf("TypeByExtension(.webmanifest) = %q: %v", mime.TypeByExtension(".webmanifest"), err)
	}
	if got != "application/manifest+json" {
		t.Errorf("manifest served as %q, want application/manifest+json", got)
	}
}
