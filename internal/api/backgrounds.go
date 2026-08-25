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
	// maxBackgroundBytes bounds one upload. A 4K JPEG comfortably fits; this is
	// mostly here to stop someone dropping a RAW photo into a SQLite row.
	maxBackgroundBytes = 8 << 20 // 8 MiB
	// maxBackgroundTotal bounds what one account can keep. Enough for a small
	// set to rotate between, not enough to fill a Pi's SD card by accident.
	maxBackgroundTotal = 40 << 20 // 40 MiB
	maxBackgroundName  = 60
)

// sniffImageType identifies an upload from its own bytes rather than trusting
// the Content-Type the browser attached, and returns "" for anything not on the
// allowlist.
//
// An allowlist, and served back with X-Content-Type-Options: nosniff, because
// these bytes are uploaded by one person and displayed to another — the
// instance background is shown to everyone, signed out included. An SVG is a
// script-execution surface dressed as a picture, so it isn't on the list.
func sniffImageType(data []byte) string {
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

	r.Body = http.MaxBytesReader(w, r.Body, maxBackgroundBytes+(1<<20)) // + multipart overhead
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "expected a multipart 'file' field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxBackgroundBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read the upload")
		return
	}
	if len(data) > maxBackgroundBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("images must be %d MiB or smaller", maxBackgroundBytes>>20))
		return
	}
	mime := sniffImageType(data)
	if mime == "" {
		writeError(w, http.StatusBadRequest, "that isn't a PNG, JPEG, WebP, AVIF or GIF")
		return
	}

	used, err := s.store.BackgroundBytesForUser(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save the image")
		return
	}
	if used+int64(len(data)) > maxBackgroundTotal {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("your backgrounds would exceed %d MiB — remove one first", maxBackgroundTotal>>20))
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
	// An image's bytes never change — a new upload is a new id — so this can be
	// cached hard. That matters for a full-screen picture on every page load.
	w.Header().Set("Cache-Control", "private, max-age=604800, immutable")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	_, _ = w.Write(data)
}
