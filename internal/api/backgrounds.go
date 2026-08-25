package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// Background images.
//
// The animated effects are drawn; this is the other kind of background — a
// picture you chose. An admin can set one for the instance (it shows on the
// login page too, so a shared instance looks like itself before anyone signs
// in), and each account can pick its own on top of that, which is the setting
// people actually asked for: one wallpaper per person, not per server.
//
// Uploads live in the database as blobs. That keeps a background inside the one
// file you back up and restore, at the cost of needing real limits — hence the
// per-file and per-account caps below.

const (
	// Defaults for the two limits an admin can change (Admin -> Advanced). A 4K
	// JPEG fits comfortably in 8 MiB, and 40 MiB is enough for a small set to
	// rotate between without filling a Pi's SD card by accident.
	defaultBGMaxImageMB = 8
	defaultBGMaxTotalMB = 40
	// Ceilings on what those settings may be set to. A limit is a dial, not a
	// licence: one row of a SQLite database is read into memory whole.
	maxBGImageLimitMB = 128
	maxBGTotalLimitMB = 4096

	maxBackgroundName = 60
)

// backgroundLimits is what this instance currently allows.
type backgroundLimits struct {
	imageBytes int64
	totalBytes int64
	allowSVG   bool
}

func (s *Server) backgroundLimits(ctx context.Context) backgroundLimits {
	const mib = 1 << 20
	return backgroundLimits{
		imageBytes: int64(clampInt(s.intSetting(ctx, keyBGMaxImageMB, defaultBGMaxImageMB), 1, maxBGImageLimitMB)) * mib,
		totalBytes: int64(clampInt(s.intSetting(ctx, keyBGMaxTotalMB, defaultBGMaxTotalMB), 1, maxBGTotalLimitMB)) * mib,
		allowSVG:   s.boolSetting(ctx, keyBGAllowSVG, false),
	}
}

// sniffImageType identifies an upload from its own bytes rather than trusting
// the Content-Type the browser attached, and returns "" for anything not on the
// allowlist.
//
// An allowlist, because these bytes are uploaded by one person and displayed to
// another — the instance background is shown to everyone, signed out included.
//
// SVG is off by default and behind its own switch, because it is the one format
// here that can carry script. Drawn as a background or through <img> a browser
// already refuses to run that script, but an SVG served from our own origin and
// opened directly in a tab would not be — so when the switch is on, the bytes go
// out under a CSP that sandboxes them into an opaque origin (see
// handleGetBackground). That is what makes allowing it a real choice rather than
// a hole.
func sniffImageType(data []byte, allowSVG bool) string {
	if allowSVG && looksLikeSVG(data) {
		return "image/svg+xml"
	}
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "image/jpeg"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "image/webp"
	case len(data) >= 12 && string(data[4:8]) == "ftyp" && strings.HasPrefix(string(data[8:12]), "avif"):
		return "image/avif"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "image/gif"
	}
	return ""
}

// looksLikeSVG checks for an <svg> root, skipping any XML declaration, comments
// or doctype in front of it. Only the shape is checked — the CSP is what makes
// the content safe, not this.
func looksLikeSVG(data []byte) bool {
	head := data
	if len(head) > 1024 {
		head = head[:1024]
	}
	return strings.Contains(strings.ToLower(string(head)), "<svg")
}

// userBackgroundsEnabled reports the admin's switch for per-user backgrounds.
// On by default: on a solo instance the owner is the admin, and having to turn
// something on before you can set your own wallpaper would be silly.
func (s *Server) userBackgroundsEnabled(ctx context.Context) bool {
	return s.boolSetting(ctx, keyUserBackgrounds, true)
}

// instanceBackgroundID is the image an admin set for the whole instance, or 0.
func (s *Server) instanceBackgroundID(ctx context.Context) int64 {
	raw := s.stringSetting(ctx, keyBrandBackground, "")
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return 0
	}
	return id
}

func (s *Server) handleListBackgrounds(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	list, err := s.store.ListBackgrounds(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list backgrounds")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// handleUploadBackground stores an image in the caller's own collection.
//
// Admins can always upload, whatever the per-user switch says, because setting
// the instance background goes through here too — the admin's own collection is
// where the instance picture is picked from.
func (s *Server) handleUploadBackground(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.userBackgroundsEnabled(r.Context()) && u.Role != "admin" {
		writeError(w, http.StatusForbidden, "background images are disabled on this instance")
		return
	}

	limits := s.backgroundLimits(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, limits.imageBytes+(1<<20)) // + multipart overhead
	file, header, err := r.FormFile("file")
	if err != nil {
		// Too big is the likely reason for a body that won't parse, and the
		// reader cuts it off before the form does — without this, an oversized
		// upload comes back as "expected a multipart 'file' field", which sends
		// people looking in entirely the wrong place.
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge,
				fmt.Sprintf("images must be %d MiB or smaller", limits.imageBytes>>20))
			return
		}
		writeError(w, http.StatusBadRequest, "expected a multipart 'file' field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, limits.imageBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read the upload")
		return
	}
	if int64(len(data)) > limits.imageBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("images must be %d MiB or smaller", limits.imageBytes>>20))
		return
	}
	mime := sniffImageType(data, limits.allowSVG)
	if mime == "" {
		kinds := "PNG, JPEG, WebP, AVIF or GIF"
		if limits.allowSVG {
			kinds = "PNG, JPEG, WebP, AVIF, GIF or SVG"
		}
		writeError(w, http.StatusBadRequest, "that isn't a "+kinds)
		return
	}

	used, err := s.store.BackgroundBytesForUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the image")
		return
	}
	if used+int64(len(data)) > limits.totalBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("your backgrounds would exceed %d MiB — remove one first", limits.totalBytes>>20))
		return
	}

	name := backgroundName(header.Filename)
	bg, err := s.store.CreateBackground(r.Context(), u.ID, name, mime, data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the image")
		return
	}
	writeJSON(w, http.StatusCreated, bg)
}

// backgroundName reduces an uploaded filename to a short label. The extension
// goes because the stored type is sniffed, not taken from the name.
func backgroundName(filename string) string {
	base := filepath.Base(strings.TrimSpace(filename))
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, base)
	base = strings.TrimSpace(base)
	if base == "" || base == "." || base == ".." {
		return "background"
	}
	if utf8.RuneCountInString(base) > maxBackgroundName {
		base = string([]rune(base)[:maxBackgroundName])
	}
	return base
}

func (s *Server) handleDeleteBackground(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Refuse to delete the picture the instance is currently using: the setting
	// would be left pointing at nothing, and every login page would quietly lose
	// its background with no clue as to why.
	if s.instanceBackgroundID(r.Context()) == id {
		writeError(w, http.StatusConflict,
			"that's the instance background — clear it in the admin area first")
		return
	}
	if err := s.store.DeleteBackground(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not delete that image")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleGetBackground serves the image itself.
//
// Readable by its owner, and by anyone at all when it is the instance
// background — that one is on the login page, so it has to be fetchable with no
// session. Every other image is owner-only.
func (s *Server) handleGetBackground(w http.ResponseWriter, r *http.Request) {
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	if s.instanceBackgroundID(ctx) != id {
		u, ok := s.requireUser(w, r)
		if !ok {
			return
		}
		bg, err := s.store.GetBackground(ctx, id)
		if err != nil || bg.UserID != u.ID {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
	}

	bg, err := s.store.GetBackground(ctx, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not read that image")
		return
	}

	// An id is not a stable name for a picture across a restore: the restored
	// database's autoincrement counter is wherever it was when the backup was
	// taken, so the next upload can land on an id a browser still has cached —
	// and paint the old wallpaper for a week. So the tag identifies the *row*,
	// and the browser is asked to check before reusing what it has. A hit costs
	// a 304 and no bytes; a restore is visible immediately.
	etag := fmt.Sprintf(`"%d-%d-%d"`, bg.ID, bg.CreatedAt.UnixNano(), bg.Size)
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, no-cache")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	data, mime, err := s.store.GetBackgroundData(ctx, id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not read that image")
		return
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Uploaded by one person, displayed to others: pin these bytes to being a
	// picture and nothing else. `sandbox` drops them into an opaque origin, so
	// even an SVG opened directly in a tab has no script, no origin and no
	// cookies to reach for; the rest of the policy denies everything a picture
	// has no business fetching.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}
