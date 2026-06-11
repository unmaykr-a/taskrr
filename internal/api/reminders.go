package api

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/andri1305/taskrr/internal/reminder"
	"github.com/andri1305/taskrr/internal/store"
)

// maxLeadSeconds caps how far ahead of a due time a reminder may fire (90 days).
const maxLeadSeconds = 90 * 24 * 60 * 60

type reminderRequest struct {
	Enabled     bool   `json:"enabled"`
	WebhookURL  string `json:"webhookUrl"`
	LeadSeconds int64  `json:"leadSeconds"`
}

// validWebhookURL accepts only absolute http(s) URLs. We deliberately allow
// private/LAN hosts — reaching a local ntfy/Home Assistant is the point.
func validWebhookURL(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func (s *Server) handleGetReminders(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	rs, err := s.store.GetReminderSettings(r.Context(), u.ID)
	if err != nil {
		writeStoreError(w, err, "could not load reminder settings")
		return
	}
	writeJSON(w, http.StatusOK, rs)
}

func (s *Server) handlePutReminders(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req reminderRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	req.WebhookURL = strings.TrimSpace(req.WebhookURL)
	if req.LeadSeconds < 0 || req.LeadSeconds > maxLeadSeconds {
		writeError(w, http.StatusBadRequest, "lead time is out of range")
		return
	}
	// A URL is required to enable, and any URL given must be a valid http(s) one.
	if req.Enabled && req.WebhookURL == "" {
		writeError(w, http.StatusBadRequest, "a webhook URL is required to enable reminders")
		return
	}
	if req.WebhookURL != "" && !validWebhookURL(req.WebhookURL) {
		writeError(w, http.StatusBadRequest, "enter a valid http(s) webhook URL")
		return
	}
	rs := store.ReminderSettings{Enabled: req.Enabled, WebhookURL: req.WebhookURL, LeadSeconds: req.LeadSeconds}
	if err := s.store.SetReminderSettings(r.Context(), u.ID, rs); err != nil {
		writeStoreError(w, err, "could not save reminder settings")
		return
	}
	writeJSON(w, http.StatusOK, rs)
}

// handleTestReminder sends a sample webhook so the user can verify delivery. It
// tests the URL in the request body if given, otherwise the saved one.
func (s *Server) handleTestReminder(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req reminderRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	target := strings.TrimSpace(req.WebhookURL)
	if target == "" {
		rs, err := s.store.GetReminderSettings(r.Context(), u.ID)
		if err != nil {
			writeStoreError(w, err, "could not load reminder settings")
			return
		}
		target = rs.WebhookURL
	}
	if !validWebhookURL(target) {
		writeError(w, http.StatusBadRequest, "enter a valid http(s) webhook URL")
		return
	}
	if err := reminder.SendTest(r.Context(), target); err != nil {
		writeError(w, http.StatusBadGateway, "webhook test failed: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
