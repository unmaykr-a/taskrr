package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unmaykr-a/taskrr/internal/store"
)

// tinyPNG is the smallest thing that still looks like a PNG to the sniffer: the
// 8-byte signature is what identifies the type, and nothing here decodes it.
var tinyPNG = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0x42}, 64)...)

// uploadBackground posts an image the way a browser would, as multipart.
func uploadBackground(t *testing.T, h http.Handler, cookie *http.Cookie, filename string, data []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("CreateFormFile: %v", err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatalf("write part: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/me/backgrounds", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeBackground(t *testing.T, rec *httptest.ResponseRecorder) store.Background {
	t.Helper()
	var bg store.Background
	if err := json.Unmarshal(rec.Body.Bytes(), &bg); err != nil {
		t.Fatalf("decode background: %v (body %s)", err, rec.Body.String())
	}
	return bg
}

// TestBackgroundsAreOwnerScoped: an uploaded picture is yours. Another account
// can neither see it in a listing, fetch its bytes, nor delete it.
func TestBackgroundsAreOwnerScoped(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	alice, _ := st.CreateUser(ctx, store.UserInput{Username: "alice", Role: "user", PasswordHash: ptr("h")})
	bob, _ := st.CreateUser(ctx, store.UserInput{Username: "bob", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	aliceCookie := signIn(t, st, s.opts.SessionTTL, alice)
	bobCookie := signIn(t, st, s.opts.SessionTTL, bob)

	rec := uploadBackground(t, h, aliceCookie, "kitchen.png", tinyPNG)
	if rec.Code != http.StatusCreated {
		t.Fatalf("upload: got %d, body %s", rec.Code, rec.Body.String())
	}
	bg := decodeBackground(t, rec)
	if bg.Name != "kitchen" || bg.Mime != "image/png" {
		t.Fatalf("unexpected metadata: %+v", bg)
	}

	// Bob's listing is empty.
	req := httptest.NewRequest(http.MethodGet, "/api/me/backgrounds", nil)
	req.AddCookie(bobCookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var bobList []store.Background
	if err := json.Unmarshal(rec.Body.Bytes(), &bobList); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(bobList) != 0 {
		t.Fatalf("bob sees %d of alice's backgrounds", len(bobList))
	}

	path := fmt.Sprintf("/api/backgrounds/%d", bg.ID)
	for name, cookie := range map[string]*http.Cookie{"bob": bobCookie, "signed out": nil} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code == http.StatusOK {
			t.Fatalf("%s could read alice's image", name)
		}
	}

	req = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/me/backgrounds/%d", bg.ID), nil)
	req.AddCookie(bobCookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-account delete: got %d, want 404", rec.Code)
	}

	// The owner can still read and delete it.
	req = httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(aliceCookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("owner read: got %d (%s)", rec.Code, rec.Header().Get("Content-Type"))
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("uploaded bytes served without nosniff (got %q)", got)
	}
}

// TestInstanceBackgroundIsPublic: the login page is signed out, so the picture
// an admin sets for the instance has to be fetchable without a session — and
// only that one.
func TestInstanceBackgroundIsPublic(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, admin)

	shared := decodeBackground(t, uploadBackground(t, h, cookie, "instance.png", tinyPNG))
	private := decodeBackground(t, uploadBackground(t, h, cookie, "mine.png", tinyPNG))

	req := httptest.NewRequest(http.MethodPut, "/api/admin/settings",
		bytes.NewReader([]byte(fmt.Sprintf(`{"brand_background":"%d"}`, shared.ID))))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("set instance background: got %d, body %s", rec.Code, rec.Body.String())
	}

	// Signed out: the instance one yes, the admin's other one no.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/backgrounds/%d", shared.ID), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("instance background signed out: got %d, want 200", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/backgrounds/%d", private.ID), nil))
	if rec.Code == http.StatusOK {
		t.Fatal("a private image was readable signed out")
	}

	// It's also announced signed out, or the login page wouldn't know to ask.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/auth/config", nil))
	var cfg struct {
		Branding struct {
			Background int64 `json:"background"`
		} `json:"branding"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if cfg.Branding.Background != shared.ID {
		t.Fatalf("auth config background = %d, want %d", cfg.Branding.Background, shared.ID)
	}

	// And it can't be deleted out from under the login page by accident.
	req = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/me/backgrounds/%d", shared.ID), nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("deleting the instance background: got %d, want 409", rec.Code)
	}
}

// TestBackgroundUploadsAreValidated: the type is decided by the bytes, not by
// what the client claimed, and the admin's switch governs who may upload.
func TestBackgroundUploadsAreValidated(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	user, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	adminCookie := signIn(t, st, s.opts.SessionTTL, admin)
	userCookie := signIn(t, st, s.opts.SessionTTL, user)

	// An SVG is a script-execution surface wearing a picture's name.
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if rec := uploadBackground(t, h, userCookie, "sneaky.png", svg); rec.Code != http.StatusBadRequest {
		t.Fatalf("SVG upload: got %d, want 400", rec.Code)
	}

	if err := st.SetSetting(ctx, keyUserBackgrounds, "false"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if rec := uploadBackground(t, h, userCookie, "later.png", tinyPNG); rec.Code != http.StatusForbidden {
		t.Fatalf("upload while disabled: got %d, want 403", rec.Code)
	}
	// The admin still can: setting the instance background goes through the
	// same endpoint, and an admin who turned the feature off for users should
	// not have turned it off for the instance.
	if rec := uploadBackground(t, h, adminCookie, "instance.png", tinyPNG); rec.Code != http.StatusCreated {
		t.Fatalf("admin upload while disabled: got %d, want 201", rec.Code)
	}
}

// TestBackgroundLimitsAreConfigurable: the caps are a dial an admin turns, and
// the turning is clamped rather than trusted.
func TestBackgroundLimitsAreConfigurable(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, admin)

	// A 2 MiB image is fine by default and too big once the cap drops to 1 MiB.
	big := append(append([]byte{}, tinyPNG...), bytes.Repeat([]byte{0x42}, 2<<20)...)
	if rec := uploadBackground(t, h, cookie, "big.png", big); rec.Code != http.StatusCreated {
		t.Fatalf("upload under the default cap: got %d, body %s", rec.Code, rec.Body.String())
	}

	settings := func(t *testing.T, body string) map[string]any {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, "/api/admin/settings", bytes.NewReader([]byte(body)))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("settings: got %d, body %s", rec.Code, rec.Body.String())
		}
		var out map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode settings: %v", err)
		}
		return out
	}

	settings(t, `{"bg_max_image_mb":1}`)
	if rec := uploadBackground(t, h, cookie, "big.png", big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("upload over the new cap: got %d, want 413", rec.Code)
	}

	// Nonsense is clamped into range, not stored as given: 0 would make uploads
	// impossible and a huge number would make one upload able to fill the disk.
	out := settings(t, `{"bg_max_image_mb":0,"bg_max_total_mb":999999}`)
	if got := out[keyBGMaxImageMB]; got != float64(1) {
		t.Fatalf("image cap = %v, want it clamped to 1", got)
	}
	if got := out[keyBGMaxTotalMB]; got != float64(maxBGTotalLimitMB) {
		t.Fatalf("total cap = %v, want it clamped to %d", got, maxBGTotalLimitMB)
	}

	// The per-account cap refuses the upload that would cross it.
	settings(t, `{"bg_max_image_mb":8,"bg_max_total_mb":1}`)
	if rec := uploadBackground(t, h, cookie, "another.png", big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("upload over the account cap: got %d, want 413", rec.Code)
	}
}

// TestSVGIsOptInAndSandboxed: refused by default, and when an admin allows it
// the bytes go out under a policy that makes the script it might carry inert.
func TestSVGIsOptInAndSandboxed(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	admin, _ := st.CreateUser(ctx, store.UserInput{Username: "admin", Role: "admin", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, admin)

	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)
	if rec := uploadBackground(t, h, cookie, "art.svg", svg); rec.Code != http.StatusBadRequest {
		t.Fatalf("SVG with the switch off: got %d, want 400", rec.Code)
	}

	if err := st.SetSetting(ctx, keyBGAllowSVG, "true"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	rec := uploadBackground(t, h, cookie, "art.svg", svg)
	if rec.Code != http.StatusCreated {
		t.Fatalf("SVG with the switch on: got %d, body %s", rec.Code, rec.Body.String())
	}
	bg := decodeBackground(t, rec)
	if bg.Mime != "image/svg+xml" {
		t.Fatalf("stored mime = %q", bg.Mime)
	}

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/backgrounds/%d", bg.ID), nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("serve SVG: got %d", rec.Code)
	}
	csp := rec.Header().Get("Content-Security-Policy")
	// `sandbox` is the load-bearing part: it drops a directly-opened SVG into an
	// opaque origin, where its script has no instance to reach.
	if !strings.Contains(csp, "sandbox") || !strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("uploaded bytes served without a sandboxing CSP (got %q)", csp)
	}
}

// TestBackgroundBytesAreRevalidated: an id is not a stable name for a picture
// across a restore, so the browser has to ask before reusing what it cached.
func TestBackgroundBytesAreRevalidated(t *testing.T) {
	ctx := context.Background()
	st := openStore(t)
	u, _ := st.CreateUser(ctx, store.UserInput{Username: "u", Role: "user", PasswordHash: ptr("h")})
	s := NewServer(st, Options{})
	h := s.Handler()
	cookie := signIn(t, st, s.opts.SessionTTL, u)

	bg := decodeBackground(t, uploadBackground(t, h, cookie, "wall.png", tinyPNG))
	path := fmt.Sprintf("/api/backgrounds/%d", bg.ID)

	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("no ETag, so a client has nothing to revalidate against")
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "no-cache") {
		t.Fatalf("Cache-Control = %q, want it to force a revalidation", cc)
	}

	// The same row: a 304 and no bytes.
	req = httptest.NewRequest(http.MethodGet, path, nil)
	req.AddCookie(cookie)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotModified {
		t.Fatalf("unchanged image: got %d, want 304", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Fatalf("304 carried %d bytes", rec.Body.Len())
	}

	// A different picture must never satisfy the old tag. This is the case a
	// restore creates: the restored database's autoincrement counter is
	// wherever the backup left it, so a later upload can land on an id some
	// browser still has cached — and the tag is what stops it painting the
	// wallpaper that used to live there.
	other := append(append([]byte{}, tinyPNG...), []byte("a different picture")...)
	second := decodeBackground(t, uploadBackground(t, h, cookie, "other.png", other))
	req = httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/backgrounds/%d", second.ID), nil)
	req.AddCookie(cookie)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("a different picture answered the old tag: got %d, want 200", rec.Code)
	}
	if !bytes.Equal(rec.Body.Bytes(), other) {
		t.Fatal("served the wrong bytes for a tag that doesn't match")
	}
	if rec.Header().Get("ETag") == etag {
		t.Fatal("two different pictures share an ETag")
	}
}

// TestBackgroundNameFromFilename covers the label an upload gets: the extension
// goes (the type is sniffed), and nothing exotic survives.
func TestBackgroundNameFromFilename(t *testing.T) {
	for in, want := range map[string]string{
		"kitchen.png":            "kitchen",
		"/tmp/holiday photo.jpg": "holiday photo",
		"":                       "background",
		"..":                     "background",
		// A dotfile is all extension as far as filepath is concerned, so
		// trimming it leaves nothing and the fallback name takes over.
		".hidden":     "background",
		".hidden.png": ".hidden",
	} {
		if got := backgroundName(in); got != want {
			t.Errorf("backgroundName(%q) = %q, want %q", in, got, want)
		}
	}
}
