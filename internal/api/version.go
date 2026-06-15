package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

// updateCacheTTL caps how often the upstream version is fetched.
const updateCacheTTL = 30 * time.Minute

var errUpstream = errors.New("update check upstream returned a non-200 status")

// handleCheckVersion reports the latest released version, fetched server-side
// from UpdateCheckURL (the browser can't reach it directly under the CSP). It is
// purely informational — there is no in-app update action. Returns
// {"latest": "x.y.z"}; "" when checking is disabled or the upstream is
// unreachable.
func (s *Server) handleCheckVersion(w http.ResponseWriter, r *http.Request) {
	// Admin-only: upgrades are an operator concern, and this matches the UI,
	// which shows the "Check for updates" button to admins only.
	if _, ok := s.requireAdmin(w, r); !ok {
		return
	}
	url := s.opts.UpdateCheckURL
	if strings.TrimSpace(url) == "" {
		writeJSON(w, http.StatusOK, map[string]string{"latest": ""})
		return
	}

	s.updateMu.Lock()
	cached := s.updateVer
	fresh := time.Since(s.updateAt) < updateCacheTTL && s.updateVer != ""
	s.updateMu.Unlock()
	if fresh {
		writeJSON(w, http.StatusOK, map[string]string{"latest": cached})
		return
	}

	latest, err := fetchLatestVersion(r.Context(), url)
	if err != nil {
		// Don't fail the UI hard: report "unknown" rather than an error code.
		writeJSON(w, http.StatusOK, map[string]string{"latest": ""})
		return
	}

	s.updateMu.Lock()
	s.updateVer = latest
	s.updateAt = time.Now()
	s.updateMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]string{"latest": latest})
}

// fetchLatestVersion GETs the upstream JSON and returns its "version" field.
func fetchLatestVersion(ctx context.Context, url string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errUpstream
	}
	// Cap the body; the upstream is a small package.json.
	var payload struct {
		Version string `json:"version"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", err
	}
	return strings.TrimSpace(payload.Version), nil
}
