package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// --- Shared tasks ---
//
// Sharing is admin-gated by the tasks_shareable setting: when off, the share
// endpoint refuses to create new shares (and the SPA hides the UI). Responding
// to or leaving an existing share stays available so members can always tidy up.

// handleShareTask lets a task's owner invite another user (by username) as a
// pending member. POST /api/tasks/{id}/share with {"username": "..."}.
func (s *Server) handleShareTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.boolSetting(r.Context(), keyTasksShareable, false) {
		writeError(w, http.StatusForbidden, "task sharing is disabled on this instance")
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Username string `json:"username"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.TrimSpace(req.Username)
	if name == "" {
		writeError(w, http.StatusBadRequest, "a username is required")
		return
	}
	recipient, err := s.store.GetUserByUsername(r.Context(), name)
	if err != nil {
		// Don't leak whether the account exists beyond the generic 404.
		writeStoreError(w, err, "could not share task")
		return
	}
	share, err := s.store.ShareTask(r.Context(), u.ID, id, recipient.ID)
	if err != nil {
		writeShareError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, share)
}

// handleRespondShare accepts or declines a pending incoming share for the
// current user. POST /api/tasks/{id}/share/respond with {"accept": true|false}.
func (s *Server) handleRespondShare(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var req struct {
		Accept bool `json:"accept"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.RespondToShare(r.Context(), u.ID, id, req.Accept); err != nil {
		writeStoreError(w, err, "could not respond to the share")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLeaveTask removes the current user's membership of a shared task. The
// task and its history persist for the owner and any other members.
// POST /api/tasks/{id}/leave.
func (s *Server) handleLeaveTask(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if err := s.store.LeaveTask(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not leave the task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListMembers returns everyone attached to a task (owner + members), for
// anyone who can see the task. GET /api/tasks/{id}/members.
func (s *Server) handleListMembers(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// Gate on visibility: only someone who can see the task may list its members.
	if _, err := s.store.GetTask(r.Context(), u.ID, id); err != nil {
		writeStoreError(w, err, "could not list members")
		return
	}
	members, err := s.store.ListTaskMembers(r.Context(), id)
	if err != nil {
		writeStoreError(w, err, "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// handleListIncomingShares returns the current user's pending incoming shares
// (their Requests view). GET /api/me/shares.
func (s *Server) handleListIncomingShares(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	reqs, err := s.store.ListIncomingShares(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list share requests")
		return
	}
	writeJSON(w, http.StatusOK, reqs)
}

// handleSetAllowShares sets the current user's opt-in for receiving shared
// tasks. PUT /api/me/allow-shares with {"allowShares": true|false}.
func (s *Server) handleSetAllowShares(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	var req struct {
		AllowShares bool `json:"allowShares"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.SetUserAllowShares(r.Context(), u.ID, req.AllowShares); err != nil {
		writeStoreError(w, err, "could not update preference")
		return
	}
	u.AllowShares = req.AllowShares
	u.Protected = u.ID == s.opts.ProtectedUserID
	writeJSON(w, http.StatusOK, u)
}

// writeShareError maps the share-specific sentinel errors to status codes.
func writeShareError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrShareSelf):
		writeError(w, http.StatusBadRequest, "you can't share a task with yourself")
	case errors.Is(err, store.ErrAlreadyShared):
		writeError(w, http.StatusConflict, "this task is already shared with that user")
	case errors.Is(err, store.ErrShareNotAllowed):
		writeError(w, http.StatusForbidden, "that user isn't accepting shared tasks")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "could not share task")
	}
}
