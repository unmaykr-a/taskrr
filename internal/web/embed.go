// Package web embeds the built frontend so the whole application ships as a
// single self-contained binary — no separate static-file server, no volume of
// assets to mount. The Vite build writes into ./dist (see web/vite.config.ts).
//
// During backend-only development the dist directory contains just a
// placeholder; the real assets are produced by `make frontend` or the Docker
// build before the binary is compiled.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// DistFS returns the embedded frontend rooted at the dist directory.
func DistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
