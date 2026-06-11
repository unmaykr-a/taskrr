package api

import (
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/andri1305/taskrr/internal/web"
)

// placeholderHTML is shown when the frontend has not been built yet (e.g. when
// running the backend alone with `go run`). The API is still fully functional.
const placeholderHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Taskrr</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#e5e5e5;
display:grid;place-items:center;height:100vh;margin:0;text-align:center}
code{background:#1a1a1a;padding:2px 6px;border-radius:4px}</style></head>
<body><div><h1>Taskrr</h1>
<p>The API is running, but the frontend hasn't been built yet.</p>
<p>Run <code>make frontend</code> (or build the Docker image) and restart.</p>
</div></body></html>`

// cacheControl returns the Cache-Control value for an embedded file. Files
// under assets/ carry a Vite content hash in their name, so they can be cached
// forever; index.html must always revalidate so a deploy shows up immediately
// (embedded files have no modtime, so without this nothing is cacheable at all
// and the whole bundle is re-downloaded on every visit). Everything else
// (favicon etc.) gets a short cache.
func cacheControl(path string) string {
	switch {
	case strings.HasPrefix(path, "assets/"):
		return "public, max-age=31536000, immutable"
	case path == "index.html":
		return "no-cache"
	default:
		return "public, max-age=3600"
	}
}

// staticHandler serves the embedded SPA. Unknown non-asset paths fall back to
// index.html so client-side routing works.
func (s *Server) staticHandler() http.Handler {
	dist, err := web.DistFS()
	if err != nil {
		log.Printf("taskrr: could not open embedded frontend: %v", err)
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			serveHTML(w, placeholderHTML)
		})
	}

	fileServer := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(r.URL.Path, "/")
		if clean == "" {
			clean = "index.html"
		}

		if f, err := dist.Open(clean); err == nil {
			_ = f.Close()
			w.Header().Set("Cache-Control", cacheControl(clean))
			fileServer.ServeHTTP(w, r)
			return
		}

		// Fallback: serve index.html for SPA routes, or the placeholder if the
		// frontend hasn't been built.
		index, err := dist.Open("index.html")
		if err != nil {
			serveHTML(w, placeholderHTML)
			return
		}
		defer index.Close()
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.Copy(w, index)
	})
}

func serveHTML(w http.ResponseWriter, html string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, html)
}
