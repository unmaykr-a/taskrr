package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unmaykr-a/taskrr/internal/auth"
	"github.com/unmaykr-a/taskrr/internal/store"
)

// inviteFixture is an instance with an admin signed in, ready to create accounts.
type inviteFixture struct {
	st    *store.Store
	h     http.Handler
	admin store.User
	cook  *http.Cookie
}

func newInviteFixture(t *testing.T) *inviteFixture {
	t.Helper()
	st := openStore(t)
	admin, err := st.CreateUser(context.Background(), store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	s := NewServer(st, Options{})
	return &inviteFixture{st: st, h: s.Handler(), admin: admin, cook: signIn(t, st, s.opts.SessionTTL, admin)}
}

func (f *inviteFixture) do(t *testing.T, method, path, body string, asAdmin bool) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	if asAdmin {
		r.AddCookie(f.cook)
	}
	w := httptest.NewRecorder()
	f.h.ServeHTTP(w, r)
	return w
}

// createInvited adds an account with no password and returns the invitation the
// admin is handed.
func (f *inviteFixture) createInvited(t *testing.T, username string) inviteInfo {
	t.Helper()
	w := f.do(t, http.MethodPost, "/api/admin/users", fmt.Sprintf(`{"username":%q}`, username), true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create user = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	var out struct {
		Username string      `json:"username"`
		Invite   *inviteInfo `json:"invite"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if out.Username != username {
		t.Fatalf("created %q, want %q", out.Username, username)
	}
	if out.Invite == nil || out.Invite.Token == "" {
		t.Fatalf("no invitation returned for a password-less account: %s", w.Body.String())
	}
	return *out.Invite
}

func (f *inviteFixture) claim(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	return f.do(t, http.MethodPost, "/api/auth/claim", body, false)
}

// claimed reports whether an account now has a password.
func (f *inviteFixture) claimed(t *testing.T, username string) bool {
	t.Helper()
	u, err := f.st.GetUserByUsername(context.Background(), username)
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	return u.PasswordHash != nil
}

// The finding this whole flow exists for: knowing a username was enough to take
// an account that hadn't been set up yet. Now it isn't.
func TestClaimNeedsTheInvitation(t *testing.T) {
	f := newInviteFixture(t)
	f.createInvited(t, "bob")

	for _, tc := range []struct {
		name string
		body string
	}{
		{"no token at all", `{"username":"bob","password":"attackers-password"}`},
		{"empty token", `{"username":"bob","password":"attackers-password","token":""}`},
		{"a guessed token", `{"username":"bob","password":"attackers-password","token":"00000000000000000000000000000000"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if w := f.claim(t, tc.body); w.Code != http.StatusForbidden {
				t.Fatalf("claim = %d, want 403 (body: %s)", w.Code, w.Body.String())
			}
			if f.claimed(t, "bob") {
				t.Fatal("the account was taken over without a valid invitation")
			}
		})
	}
}

// The invitation still has to let the right person in.
func TestClaimWithInvitationSignsIn(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")

	w := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"bobs-password","token":%q}`, inv.Token))
	if w.Code != http.StatusCreated {
		t.Fatalf("claim = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	if !f.claimed(t, "bob") {
		t.Fatal("password was not set")
	}
	var gotCookie bool
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookie && c.Value != "" {
			gotCookie = true
		}
	}
	if !gotCookie {
		t.Fatal("claiming did not start a session")
	}
	// The link is spent: a second use can't reset the password someone chose.
	replay := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"someone-elses","token":%q}`, inv.Token))
	if replay.Code != http.StatusForbidden {
		t.Fatalf("replayed claim = %d, want 403 (body: %s)", replay.Code, replay.Body.String())
	}
}

// A link is for one account, and can't be pointed at another.
func TestClaimRefusesAMismatchedUsername(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")
	f.createInvited(t, "carol")

	w := f.claim(t, fmt.Sprintf(`{"username":"carol","password":"not-carols","token":%q}`, inv.Token))
	if w.Code != http.StatusForbidden {
		t.Fatalf("claim = %d, want 403 (body: %s)", w.Code, w.Body.String())
	}
	if f.claimed(t, "carol") || f.claimed(t, "bob") {
		t.Fatal("a mismatched claim set a password anyway")
	}
}

// Reissuing is how an admin fixes a lost or lapsed link — and it has to retire
// the old one, or every link ever sent stays live.
func TestReissuingInvalidatesThePreviousLink(t *testing.T) {
	f := newInviteFixture(t)
	first := f.createInvited(t, "bob")
	u, err := f.st.GetUserByUsername(context.Background(), "bob")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}

	w := f.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/invite", u.ID), "", true)
	if w.Code != http.StatusCreated {
		t.Fatalf("reissue = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	var second inviteInfo
	if err := json.Unmarshal(w.Body.Bytes(), &second); err != nil {
		t.Fatalf("decode invite: %v", err)
	}
	if second.Token == first.Token {
		t.Fatal("reissue returned the same token")
	}
	if got := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"stale-link","token":%q}`, first.Token)); got.Code != http.StatusForbidden {
		t.Fatalf("claim with the retired link = %d, want 403", got.Code)
	}
	if got := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"fresh-link","token":%q}`, second.Token)); got.Code != http.StatusCreated {
		t.Fatalf("claim with the new link = %d, want 201 (body: %s)", got.Code, got.Body.String())
	}
}

// A link left in a chat history a month later is not a way in.
func TestExpiredInvitationIsRefused(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")
	u, err := f.st.GetUserByUsername(context.Background(), "bob")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	// Age the stored invitation past its lifetime, keeping the same secret.
	if err := f.st.SetUserInvite(context.Background(), u.ID, hashOf(inv.Token), time.Now().Add(-time.Minute)); err != nil {
		t.Fatalf("SetUserInvite: %v", err)
	}
	if w := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"too-late","token":%q}`, inv.Token)); w.Code != http.StatusForbidden {
		t.Fatalf("claim = %d, want 403 (body: %s)", w.Code, w.Body.String())
	}
	if w := f.do(t, http.MethodGet, "/api/auth/invite?token="+inv.Token, "", false); w.Code != http.StatusForbidden {
		t.Fatalf("invite lookup = %d, want 403", w.Code)
	}
}

// The sign-in page asks whose account a link opens, so nobody has to be told a
// username separately. A bad token learns nothing.
func TestInviteLookup(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")

	w := f.do(t, http.MethodGet, "/api/auth/invite?token="+inv.Token, "", false)
	if w.Code != http.StatusOK {
		t.Fatalf("lookup = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var out struct {
		Username string `json:"username"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Username != "bob" {
		t.Fatalf("username = %q, want %q", out.Username, "bob")
	}
	for _, bad := range []string{"", "not-a-token"} {
		if w := f.do(t, http.MethodGet, "/api/auth/invite?token="+bad, "", false); w.Code != http.StatusForbidden {
			t.Fatalf("lookup with %q = %d, want 403", bad, w.Code)
		}
	}
}

// An account created with a password is not waiting for anyone, so there is
// nothing to hand out — and nothing to reissue later either.
func TestNoInvitationWhenAPasswordIsSet(t *testing.T) {
	f := newInviteFixture(t)
	w := f.do(t, http.MethodPost, "/api/admin/users", `{"username":"dave","password":"daves-password"}`, true)
	if w.Code != http.StatusCreated {
		t.Fatalf("create = %d, want 201 (body: %s)", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"invite"`) {
		t.Fatalf("an invitation was issued for an account that has a password: %s", w.Body.String())
	}
	u, err := f.st.GetUserByUsername(context.Background(), "dave")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if got := f.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/invite", u.ID), "", true); got.Code != http.StatusConflict {
		t.Fatalf("reissue for a set-up account = %d, want 409", got.Code)
	}
}

// Issuing invitations is an admin's job.
func TestInviteIssuingIsAdminOnly(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")
	u, err := f.st.GetUserByUsername(context.Background(), "bob")
	if err != nil {
		t.Fatalf("GetUserByUsername: %v", err)
	}
	if w := f.claim(t, fmt.Sprintf(`{"username":"bob","password":"bobs-password","token":%q}`, inv.Token)); w.Code != http.StatusCreated {
		t.Fatalf("claim = %d, want 201", w.Code)
	}
	bobCookie := signIn(t, f.st, 24*time.Hour, u)

	r := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/admin/users/%d/invite", f.admin.ID), nil)
	r.AddCookie(bobCookie)
	w := httptest.NewRecorder()
	f.h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("invite as a non-admin = %d, want 403", w.Code)
	}
	if anon := f.do(t, http.MethodPost, fmt.Sprintf("/api/admin/users/%d/invite", u.ID), "", false); anon.Code != http.StatusUnauthorized {
		t.Fatalf("invite signed out = %d, want 401", anon.Code)
	}
}

// The secret travels in the URL fragment, which browsers keep to themselves —
// it must not appear in the path or query, where proxies log it.
func TestInviteLinkKeepsTheTokenInTheFragment(t *testing.T) {
	f := newInviteFixture(t)
	inv := f.createInvited(t, "bob")
	if !strings.Contains(inv.URL, "/#invite="+inv.Token) {
		t.Fatalf("invite URL %q does not carry the token in its fragment", inv.URL)
	}
	if before, _, _ := strings.Cut(inv.URL, "#"); strings.Contains(before, inv.Token) {
		t.Fatalf("invite URL %q leaks the token before the fragment", inv.URL)
	}
	if inv.ExpiresAt.Before(time.Now()) {
		t.Fatalf("invitation already expired at %s", inv.ExpiresAt)
	}
}

// hashOf mirrors what the server stores for an invitation.
func hashOf(token string) string { return auth.HashToken(token) }
