package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// sharedTheme is an admin-published theme available to every user. The theme
// body itself is an opaque JSON blob owned by the frontend (like the default
// theme); we only require a name to key it by.
type sharedTheme struct {
	Name string `json:"name"`
}

const maxSharedThemes = 100

func (s *Server) loadSharedThemes(r *http.Request) []json.RawMessage {
	raw, ok, _ := s.store.GetSetting(r.Context(), keySharedThemes)
	if !ok || raw == "" {
		return []json.RawMessage{}
	}
	var out []json.RawMessage
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return []json.RawMessage{}
	}
	return out
}

// handleListSharedThemes returns the admin-published themes (any signed-in user).
func (s *Server) handleListSharedThemes(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireUser(w, r); !ok {
		return
	}
	writeJSON(w, http.StatusOK, s.loadSharedThemes(r))
}

// handleShareTheme publishes (or replaces, by name) a theme so every user can
// apply it. Admin-only, and gated on the themes_shareable setting being on.
func (s *Server) handleShareTheme(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	if !s.boolSetting(r.Context(), keyThemesShareable, false) {
		writeError(w, http.StatusForbidden, "theme sharing is disabled")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 256<<10)) // 256 KiB per theme is ample
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read body")
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "theme must be valid JSON")
		return
	}
	var meta sharedTheme
	if err := json.Unmarshal(body, &meta); err != nil || strings.TrimSpace(meta.Name) == "" {
		writeError(w, http.StatusBadRequest, "theme needs a name")
		return
	}
	name := strings.TrimSpace(meta.Name)

	themes := s.loadSharedThemes(r)
	// Replace an existing theme with the same name, else append (capped).
	replaced := false
	for i, t := range themes {
		var m sharedTheme
		if json.Unmarshal(t, &m) == nil && strings.EqualFold(strings.TrimSpace(m.Name), name) {
			themes[i] = json.RawMessage(body)
			replaced = true
			break
		}
	}
	if !replaced {
		if len(themes) >= maxSharedThemes {
			writeError(w, http.StatusConflict, "too many shared themes — remove some first")
			return
		}
		themes = append(themes, json.RawMessage(body))
	}
	if err := s.saveSharedThemes(w, r, themes); err != nil {
		return
	}
	writeJSON(w, http.StatusOK, themes)
}

// handleUnshareTheme removes a shared theme by name (admin-only).
func (s *Server) handleUnshareTheme(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	themes := s.loadSharedThemes(r)
	kept := themes[:0]
	for _, t := range themes {
		var m sharedTheme
		if json.Unmarshal(t, &m) == nil && strings.EqualFold(strings.TrimSpace(m.Name), name) {
			continue
		}
		kept = append(kept, t)
	}
	if err := s.saveSharedThemes(w, r, kept); err != nil {
		return
	}
	writeJSON(w, http.StatusOK, kept)
}

func (s *Server) saveSharedThemes(w http.ResponseWriter, r *http.Request, themes []json.RawMessage) error {
	encoded, err := json.Marshal(themes)
	if err == nil {
		err = s.store.SetSetting(r.Context(), keySharedThemes, string(encoded))
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save shared themes")
	}
	return err
}
