package api

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// Invitations.
//
// An account an admin creates without a password is waiting for its owner to
// pick one. The question is how the server knows that whoever turns up to pick
// it is the person the account was made for — and a username is not an answer,
// because usernames are meant to be known. They appear on shared tasks, in
// folder members and in the audit log, and on a small instance they are usually
// just people's first names.
//
// So creating such an account also mints a one-time secret, and setting the
// first password requires it. The admin gets a link to hand over however they
// already talk to that person; the link works once, lapses after a week, and can
// be reissued (which invalidates the previous one). Only its digest is stored.
//
// The token rides in the URL's fragment rather than its query, so it stays in
// the browser: fragments are never sent to the server, which keeps the secret
// out of proxy access logs and Referer headers on the way in.

// inviteTTL is how long an invitation stays good. Long enough to survive a
// weekend and a missed message; short enough that a link forgotten in a chat
// history is not a standing key to the instance.
const inviteTTL = 7 * 24 * time.Hour

// inviteInfo is an invitation as handed to the admin who created it. The token
// is returned exactly once, at this moment — afterwards only its digest exists.
type inviteInfo struct {
	Token     string    `json:"token"`
	URL       string    `json:"url"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// issueInvite mints a fresh invitation for a user, replacing any outstanding one.
func (s *Server) issueInvite(r *http.Request, userID int64) (*inviteInfo, error) {
	token, hash, err := auth.NewSessionToken()
	if err != nil {
		return nil, err
	}
	expires := time.Now().UTC().Add(inviteTTL)
	if err := s.store.SetUserInvite(r.Context(), userID, hash, expires); err != nil {
		return nil, err
	}
	return &inviteInfo{
		Token:     token,
		URL:       s.baseURL(r) + "/#invite=" + url.QueryEscape(token),
		ExpiresAt: expires,
	}, nil
}

// handleAdminInviteUser reissues the invitation for an account that is still
// waiting to be claimed — for a link that lapsed, never arrived, or belongs to
// an account created before invitations existed.
func (s *Server) handleAdminInviteUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.requireAdmin(w, r)
	if !ok {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	if s.protectsAgainst(admin.ID, id) {
		writeError(w, http.StatusForbidden, "the primary admin account can't be changed by other admins")
		return
	}
	if s.oidcOnlyActive(r.Context()) {
		writeError(w, http.StatusForbidden, "local sign-in is disabled — use single sign-on")
		return
	}
	u, err := s.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeStoreError(w, err, "could not load user")
		return
	}
	if u.PasswordHash != nil || u.OIDCSubject != nil {
		writeError(w, http.StatusConflict, "this account is already set up — it doesn't need an invitation")
		return
	}
	invite, err := s.issueInvite(r, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create an invitation")
		return
	}
	writeJSON(w, http.StatusCreated, invite)
}

// handleInviteInfo tells the sign-in page which account a link opens, so the
// person following one sees whose account they are setting up instead of being
// asked to type a username they may not have been told.
//
// Anyone holding the token can ask; that is what holding it means. Every failure
// looks the same, so this can't be used to sort real tokens from expired ones.
func (s *Server) handleInviteInfo(w http.ResponseWriter, r *http.Request) {
	if s.restoreInProgress(w) {
		return
	}
	if !s.ipThrottle(w, r) {
		return
	}
	if s.oidcOnlyActive(r.Context()) {
		writeError(w, http.StatusForbidden, "local sign-in is disabled — use single sign-on")
		return
	}
	u, ok := s.userForInvite(w, r.URL.Query().Get("token"), r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": u.Username, "expiresAt": u.InviteExpiresAt})
}

// userForInvite resolves a presented token to the account it opens, writing the
// one generic refusal on every failure — lapsed, spent, mistyped or never real.
func (s *Server) userForInvite(w http.ResponseWriter, token string, r *http.Request) (store.User, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		writeError(w, http.StatusForbidden, inviteRejected)
		return store.User{}, false
	}
	u, err := s.store.UserByInvite(r.Context(), auth.HashToken(token), time.Now())
	// An invitation is cleared the moment a password is set, so a user still
	// holding one has neither; checked anyway, because this is the door.
	if err != nil || u.PasswordHash != nil || u.OIDCSubject != nil {
		writeError(w, http.StatusForbidden, inviteRejected)
		return store.User{}, false
	}
	return u, true
}

const inviteRejected = "this invitation isn't valid any more — ask an admin for a new link"
