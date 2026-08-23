package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// --- Shared folders ---
//
// The coarser grain of the same feature, behind the same admin gate as per-task
// sharing: a household with fifteen chores in "Home" shouldn't need fifteen
// invitations, nor another one every time a chore is added.
//
// The folder name travels in the path, escaped once by the client and decoded by
// ServeMux. Everything else mirrors the per-task endpoints, deliberately — a
// member responds, leaves, or is removed by the owner in exactly the same way.

// folderFromPath pulls the {folder} path value.
//
// ServeMux already percent-decodes a wildcard segment, so this must NOT decode
// again: a folder legitimately named "100% done" arrives here correct, and a
// second pass would try to read "% d" as an escape and fail. The client escapes
// once on the way out and that is the whole of it.
func folderFromPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	folder := strings.TrimSpace(r.PathValue("folder"))
	if folder == "" {
		writeError(w, http.StatusBadRequest, "choose a folder to share")
		return "", false
	}
	return folder, true
}

// handleShareFolder invites a user to everything the owner keeps in a folder.
func (s *Server) handleShareFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.boolSetting(r.Context(), keyTasksShareable, false) {
		writeError(w, http.StatusForbidden, "task sharing is disabled on this instance")
		return
	}
	folder, ok := folderFromPath(w, r)
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
		writeStoreError(w, err, "could not share folder")
		return
	}
	share, err := s.store.ShareFolder(r.Context(), u.ID, folder, recipient.ID)
	if err != nil {
		writeFolderShareError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, share)
}

// handleRespondFolderShare accepts or declines a pending folder invitation.
func (s *Server) handleRespondFolderShare(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	folder, ok := folderFromPath(w, r)
	if !ok {
		return
	}
	var req struct {
		OwnerID int64 `json:"ownerId"`
		Accept  bool  `json:"accept"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.RespondToFolderShare(r.Context(), u.ID, req.OwnerID, folder, req.Accept); err != nil {
		writeStoreError(w, err, "could not respond to the invitation")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleLeaveFolder drops the caller's own membership of someone's folder.
func (s *Server) handleLeaveFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	folder, ok := folderFromPath(w, r)
	if !ok {
		return
	}
	var req struct {
		OwnerID int64 `json:"ownerId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.LeaveFolder(r.Context(), u.ID, req.OwnerID, folder); err != nil {
		writeStoreError(w, err, "could not leave the folder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleUnshareFolder removes a member the owner had invited.
func (s *Server) handleUnshareFolder(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	folder, ok := folderFromPath(w, r)
	if !ok {
		return
	}
	var req struct {
		UserID int64 `json:"userId"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if err := s.store.UnshareFolder(r.Context(), u.ID, folder, req.UserID); err != nil {
		writeStoreError(w, err, "could not remove that member")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleListFolderMembers lists everyone on one of the caller's own folders.
// Owner-scoped: this is about a folder in *your* account, so there is nothing
// to resolve for anyone else.
func (s *Server) handleListFolderMembers(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	folder, ok := folderFromPath(w, r)
	if !ok {
		return
	}
	members, err := s.store.ListFolderMembers(r.Context(), u.ID, folder)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

// handleListIncomingFolderShares returns the caller's pending folder invites.
func (s *Server) handleListIncomingFolderShares(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	reqs, err := s.store.ListIncomingFolderShares(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list invitations")
		return
	}
	writeJSON(w, http.StatusOK, reqs)
}

// handleListMyFolderShares returns every folder the caller has shared out, so
// the UI can mark which folders already have people on them.
func (s *Server) handleListMyFolderShares(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	shares, err := s.store.ListFolderSharesByOwner(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list folder shares")
		return
	}
	writeJSON(w, http.StatusOK, shares)
}

func writeFolderShareError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrFolderEmpty):
		writeError(w, http.StatusBadRequest, "choose a folder to share")
	case errors.Is(err, store.ErrShareSelf):
		writeError(w, http.StatusBadRequest, "you can't share a folder with yourself")
	case errors.Is(err, store.ErrAlreadyShared):
		writeError(w, http.StatusConflict, "that folder is already shared with that user")
	case errors.Is(err, store.ErrShareNotAllowed):
		writeError(w, http.StatusForbidden, "that user isn't accepting shared tasks")
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	default:
		writeError(w, http.StatusInternalServerError, "could not share folder")
	}
}
