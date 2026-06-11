package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// OIDC settings keys (admin-editable; seeded from env at bootstrap).
const (
	keyOIDCIssuer       = "oidc_issuer"
	keyOIDCClientID     = "oidc_client_id"
	keyOIDCClientSecret = "oidc_client_secret"
	keyOIDCRedirectURL  = "oidc_redirect_url"
	keyOIDCAdminGroup   = "oidc_admin_group" // membership of this group ⇒ admin role
	// keyOIDCLinkUsername (default off): on a first OIDC sign-in whose username
	// matches an existing local account, attach the identity to that account
	// instead of failing. Off by default because it lets anyone who can obtain a
	// matching username at the provider take over the local account; the safe
	// path is the user-driven link in Settings → Account (or an admin merge).
	keyOIDCLinkUsername = "oidc_link_username"
)

const (
	oidcStateCookie = "oidc_state"
	oidcNonceCookie = "oidc_nonce"
	oidcLinkCookie  = "oidc_link" // set when the flow should *link* to the current account
)

// oidcSettings is the resolved OIDC configuration from the settings store.
type oidcSettings struct {
	issuer, clientID, clientSecret, redirectURL, adminGroup string
}

func (c oidcSettings) configured() bool {
	// The redirect URL is optional — we derive it from the request when blank.
	return c.issuer != "" && c.clientID != "" && c.clientSecret != ""
}

func (c oidcSettings) key() string {
	return strings.Join([]string{c.issuer, c.clientID, c.clientSecret, c.redirectURL}, "|")
}

// oidcManager lazily builds (and caches) the provider/verifier/oauth config from
// the current settings, rebuilding only when the settings actually change.
type oidcManager struct {
	mu       sync.Mutex
	key      string
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
}

func (s *Server) oidcSettings(ctx context.Context) oidcSettings {
	get := func(k string) string {
		v, _, _ := s.store.GetSetting(ctx, k)
		return v
	}
	return oidcSettings{
		issuer:       get(keyOIDCIssuer),
		clientID:     get(keyOIDCClientID),
		clientSecret: get(keyOIDCClientSecret),
		redirectURL:  get(keyOIDCRedirectURL),
		adminGroup:   get(keyOIDCAdminGroup),
	}
}

func (s *Server) oidcEnabled(ctx context.Context) bool {
	return s.oidcSettings(ctx).configured()
}

// oidcClient returns a verifier + oauth config for the current settings, doing
// provider discovery (a network call) only when the config changes.
func (s *Server) oidcClient(ctx context.Context, cfg oidcSettings) (*oidc.IDTokenVerifier, *oauth2.Config, error) {
	if !cfg.configured() {
		return nil, nil, errors.New("OIDC is not configured")
	}
	s.oidc.mu.Lock()
	defer s.oidc.mu.Unlock()
	if s.oidc.key == cfg.key() && s.oidc.verifier != nil {
		return s.oidc.verifier, s.oidc.oauth, nil
	}
	// Pass the issuer exactly as configured — go-oidc requires the discovery
	// document's `issuer` to match this string verbatim, and Authentik's issuer
	// keeps its trailing slash. (Trimming it broke discovery with a mismatch.)
	// Bound the discovery network call so a wrong/unreachable issuer fails fast
	// instead of hanging the request (which surfaces as a gateway 502).
	dctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	provider, err := oidc.NewProvider(dctx, strings.TrimSpace(cfg.issuer))
	if err != nil {
		return nil, nil, err
	}
	s.oidc.verifier = provider.Verifier(&oidc.Config{ClientID: cfg.clientID})
	s.oidc.oauth = &oauth2.Config{
		ClientID:     cfg.clientID,
		ClientSecret: cfg.clientSecret,
		RedirectURL:  cfg.redirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	s.oidc.key = cfg.key()
	return s.oidc.verifier, s.oidc.oauth, nil
}

func randToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Server) setShortCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		HttpOnly: true,
		Secure:   s.opts.CookieSecure,
		SameSite: http.SameSiteLaxMode, // must survive the provider redirect back
		MaxAge:   300,
	})
}

func (s *Server) clearShortCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: true, Secure: s.opts.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
}

// handleOIDCLogin redirects the browser to the provider's authorization page.
func (s *Server) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	s.startOIDCFlow(w, r, false)
}

// handleOIDCLink starts the OIDC flow to *link* the provider identity to the
// already-signed-in account (rather than logging in / provisioning a new one).
func (s *Server) handleOIDCLink(w http.ResponseWriter, r *http.Request) {
	if _, ok := userFrom(r.Context()); !ok {
		http.Redirect(w, r, "/", http.StatusFound)
		return
	}
	s.startOIDCFlow(w, r, true)
}

func (s *Server) startOIDCFlow(w http.ResponseWriter, r *http.Request, link bool) {
	cfg := s.oidcSettings(r.Context())
	if !cfg.configured() {
		writeError(w, http.StatusNotFound, "OIDC is not configured")
		return
	}
	_, oauth, err := s.oidcClient(r.Context(), cfg)
	if err != nil {
		// configured() is true but discovery failed — almost always a bad issuer
		// URL or the server can't reach the provider. Surface it instead of the
		// misleading "not configured", and log the cause for the operator.
		log.Printf("oidc: provider discovery failed for issuer %q: %v", cfg.issuer, err)
		writeError(w, http.StatusBadGateway, "could not reach the OIDC provider — check the Issuer URL and that the server can reach it")
		return
	}
	state, nonce := randToken(), randToken()
	s.setShortCookie(w, oidcStateCookie, state)
	s.setShortCookie(w, oidcNonceCookie, nonce)
	if link {
		s.setShortCookie(w, oidcLinkCookie, "1")
	}
	// Use the configured redirect URL, or derive it from this request.
	o := *oauth
	o.RedirectURL = s.oidcRedirectURL(r, cfg)
	http.Redirect(w, r, o.AuthCodeURL(state, oidc.Nonce(nonce)), http.StatusFound)
}

// oidcRedirectURL returns the configured callback URL, or one derived from the
// incoming request (honouring the reverse proxy's X-Forwarded-* headers) when
// the admin left it blank — so it "just works" like other OIDC apps.
func (s *Server) oidcRedirectURL(r *http.Request, cfg oidcSettings) string {
	if strings.TrimSpace(cfg.redirectURL) != "" {
		return strings.TrimSpace(cfg.redirectURL)
	}
	return baseURL(r) + "/api/auth/oidc/callback"
}

func baseURL(r *http.Request) string {
	proto := r.Header.Get("X-Forwarded-Proto")
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := r.Header.Get("X-Forwarded-Host")
	if host == "" {
		host = r.Host
	}
	return proto + "://" + host
}

// handleOIDCCallback completes the code flow: it verifies state + the ID token,
// finds or provisions the user, maps groups to a role, starts a session, and
// redirects to the app.
func (s *Server) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg := s.oidcSettings(ctx)
	verifier, oauth, err := s.oidcClient(ctx, cfg)
	if err != nil {
		log.Printf("oidc: provider discovery failed during callback for issuer %q: %v", cfg.issuer, err)
		writeError(w, http.StatusBadGateway, "could not reach the OIDC provider")
		return
	}

	// CSRF: the state query param must match the cookie we set.
	stateCookie, err := r.Cookie(oidcStateCookie)
	if err != nil || r.URL.Query().Get("state") != stateCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid OIDC state")
		return
	}

	// Bound the upstream calls (token exchange + JWKS fetch for verification) so a
	// slow/unreachable provider fails fast with a clean error instead of hanging
	// the request — an unbounded hang here is what surfaced as a gateway 502.
	netCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	// The redirect_uri sent on exchange must match the one used at login.
	o := *oauth
	o.RedirectURL = s.oidcRedirectURL(r, cfg)
	oauth2Token, err := o.Exchange(netCtx, r.URL.Query().Get("code"))
	if err != nil {
		log.Printf("oidc: token exchange failed: %v", err)
		writeError(w, http.StatusBadGateway, "OIDC token exchange failed")
		return
	}
	rawIDToken, ok := oauth2Token.Extra("id_token").(string)
	if !ok {
		writeError(w, http.StatusBadGateway, "OIDC response missing id_token")
		return
	}
	idToken, err := verifier.Verify(netCtx, rawIDToken)
	if err != nil {
		log.Printf("oidc: id_token verification failed: %v", err)
		writeError(w, http.StatusUnauthorized, "OIDC id_token verification failed")
		return
	}
	if nonceCookie, err := r.Cookie(oidcNonceCookie); err != nil || idToken.Nonce != nonceCookie.Value {
		writeError(w, http.StatusBadRequest, "invalid OIDC nonce")
		return
	}

	var claims struct {
		Sub               string   `json:"sub"`
		Email             string   `json:"email"`
		PreferredUsername string   `json:"preferred_username"`
		Groups            []string `json:"groups"`
	}
	if err := idToken.Claims(&claims); err != nil || claims.Sub == "" {
		writeError(w, http.StatusBadGateway, "OIDC claims missing subject")
		return
	}

	// Link mode: attach this identity to the already-signed-in account, rather
	// than logging in / provisioning. Redirects back to the SPA with a status.
	if c, err := r.Cookie(oidcLinkCookie); err == nil && c.Value == "1" {
		s.clearShortCookie(w, oidcLinkCookie)
		current, ok := userFrom(ctx)
		if !ok {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		if existing, err := s.store.GetUserByOIDCSubject(ctx, claims.Sub); err == nil && existing.ID != current.ID {
			http.Redirect(w, r, "/?oidcLink=conflict", http.StatusFound)
			return
		}
		if err := s.store.LinkOIDCSubject(ctx, current.ID, claims.Sub); err != nil {
			log.Printf("oidc: link failed: %v", err)
			http.Redirect(w, r, "/?oidcLink=error", http.StatusFound)
			return
		}
		http.Redirect(w, r, "/?oidcLink=linked", http.StatusFound)
		return
	}

	user, err := s.resolveOIDCUser(ctx, cfg, claims.Sub, oidcUsername(claims.PreferredUsername, claims.Email, claims.Sub), claims.Groups)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	if err := s.startSession(w, r, user); err != nil {
		writeError(w, http.StatusInternalServerError, "could not start session")
		return
	}
	// Back to the SPA.
	http.Redirect(w, r, "/", http.StatusFound)
}

func oidcUsername(preferred, email, sub string) string {
	for _, c := range []string{preferred, email} {
		if strings.TrimSpace(c) != "" {
			return strings.TrimSpace(c)
		}
	}
	return "oidc-" + sub
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}

// resolveOIDCUser finds the account for an OIDC subject (linking by username or
// auto-provisioning when allowed) and syncs the admin role from group membership.
func (s *Server) resolveOIDCUser(ctx context.Context, cfg oidcSettings, sub, username string, groups []string) (store.User, error) {
	desiredAdmin := cfg.adminGroup != "" && contains(groups, cfg.adminGroup)

	u, err := s.store.GetUserByOIDCSubject(ctx, sub)
	if err == nil {
		s.syncOIDCRole(ctx, u, desiredAdmin)
		return s.store.GetUserByID(ctx, u.ID)
	}
	if !errors.Is(err, store.ErrNotFound) {
		return store.User{}, err
	}

	// No account linked to this subject yet.
	if existing, e := s.store.GetUserByUsername(ctx, username); e == nil {
		// An account with this username already exists. Only graft the OIDC
		// identity onto it when the admin has opted in — automatic linking means
		// whoever controls a matching username at the provider gets this account.
		if !s.boolSetting(ctx, keyOIDCLinkUsername, false) {
			return store.User{}, fmt.Errorf(
				"an account named %q already exists — sign in with its password and connect SSO from Settings, or ask an admin",
				existing.Username)
		}
		if err := s.store.LinkOIDCSubject(ctx, existing.ID, sub); err != nil {
			return store.User{}, err
		}
		s.syncOIDCRole(ctx, existing, desiredAdmin)
		return s.store.GetUserByID(ctx, existing.ID)
	}

	// Brand-new user: only if OIDC auto-provisioning is enabled.
	if !s.boolSetting(ctx, keyRegOIDC, true) {
		return store.User{}, errors.New("OIDC sign-up is disabled")
	}
	role := "user"
	if desiredAdmin {
		role = "admin"
	}
	return s.store.CreateUser(ctx, store.UserInput{Username: username, OIDCSubject: &sub, Role: role})
}

// syncOIDCRole promotes a user to admin when they're in the configured admin
// group. It will also demote — but only an account whose role is governed by
// OIDC (an OIDC-only account, with no local password): a locally-managed account
// keeps the role a local admin gave it, and the protected bootstrap admin is
// never demoted. The last remaining admin is never demoted either.
//
// This is what makes self-service linking safe: connecting SSO to your existing
// account (local user, local admin, or the primary admin) can grant admin via a
// group, but can never silently strip a role you were given locally.
func (s *Server) syncOIDCRole(ctx context.Context, u store.User, desiredAdmin bool) {
	if desiredAdmin {
		if u.Role != "admin" {
			_ = s.store.UpdateUserRole(ctx, u.ID, "admin")
		}
		return
	}
	// Demotion only applies to OIDC-governed accounts and never to the primary
	// admin: leave locally-managed roles alone.
	if u.Role != "admin" || u.PasswordHash != nil || u.ID == s.opts.ProtectedUserID {
		return
	}
	if n, err := s.store.CountAdmins(ctx); err == nil && n > 1 {
		_ = s.store.UpdateUserRole(ctx, u.ID, "user")
	}
}
